using System;
using System.IO;
using System.ComponentModel;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.FlightSimulator.SimConnect;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--check-runtime")
            {
                CheckRuntime();
                return;
            }
            var configuration = BridgeConfiguration.FromEnvironment();
            if (args.Length == 1 && args[0] == "--check-configuration")
            {
                Log("BRIDGE", "Connection configuration valid");
                return;
            }
            if (args.Length != 0) throw new ArgumentException("Usage: PaxAgent.exe [--check-runtime|--check-configuration]");
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            using (var window = new BridgeWindow(configuration))
            {
                Console.CancelKeyPress += (sender, e) => {
                    e.Cancel = true;
                    window.BeginInvoke(new Action(Application.ExitThread));
                };
                Application.Run(); // Hidden Win32 message window; SimConnect stays on this thread.
            }
        }
        catch (Exception ex)
        {
            Log("BRIDGE", "Startup failed: keep all runtime package files together", ex.ToString());
            Environment.ExitCode = 1;
        }
    }

    private static void CheckRuntime()
    {
        if (!Environment.Is64BitProcess) throw new InvalidOperationException("Expected an x64 process");
        var directory = AppDomain.CurrentDomain.BaseDirectory;
        var managedPath = typeof(SimConnect).Assembly.Location;
        if (!string.Equals(Path.GetDirectoryName(managedPath), directory.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SimConnect must load from the application folder: " + managedPath);
        var native = LoadLibraryEx(Path.Combine(directory, "SimConnect.dll"), IntPtr.Zero, 8);
        if (native == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        FreeLibrary(native);
        if (Marshal.SizeOf(typeof(RawTelemetry)) != 352 || Marshal.OffsetOf(typeof(RawTelemetry), "Title").ToInt32() != 96)
            throw new InvalidOperationException("Unexpected telemetry interop layout: expected 12 doubles followed by STRING256");
        Log("BRIDGE", "Runtime dependencies loaded successfully (x64, app-local SimConnect). Live MSFS connection not tested.");
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
    [DllImport("kernel32.dll")]
    private static extern bool FreeLibrary(IntPtr module);

    public static void Log(string component, string message, string detail = null)
    {
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), component, message, detail
        }));
    }
}

internal sealed class BridgeConfiguration
{
    public Uri Endpoint { get; private set; }
    public string Token { get; private set; }

    public static BridgeConfiguration FromEnvironment()
    {
        var address = Environment.GetEnvironmentVariable("PAX_BRIDGE_URL") ?? "ws://127.0.0.1:3001/bridge";
        var token = Environment.GetEnvironmentVariable("PAX_BRIDGE_TOKEN") ?? "";
        Uri endpoint;
        if (!Uri.TryCreate(address, UriKind.Absolute, out endpoint) ||
            (endpoint.Scheme != "ws" && endpoint.Scheme != "wss") ||
            (!endpoint.IsLoopback && endpoint.Scheme != "wss") ||
            endpoint.AbsolutePath != "/bridge" || endpoint.Query != "" || endpoint.Fragment != "" || endpoint.UserInfo != "")
            throw new ArgumentException("PAX_BRIDGE_URL must be wss://your-host/bridge (ws is allowed only on loopback). Do not put credentials in the URL.");
        if ((!endpoint.IsLoopback || token.Length > 0) &&
            !System.Text.RegularExpressions.Regex.IsMatch(token, @"\A[\x21-\x7e]{32,256}\z"))
            throw new ArgumentException("PAX_BRIDGE_TOKEN must contain 32–256 non-space ASCII characters for a hosted connection.");
        return new BridgeConfiguration { Endpoint = endpoint, Token = token };
    }
}

internal sealed class BridgeWindow : Control
{
    private readonly BridgeConfiguration configuration;
    private const int SimMessage = 0x0402;
    private enum DefinitionId : uint { Telemetry = 1 }
    private enum RequestId : uint { Health = 3 }
    private enum EventId : uint { Sim = 10, Pause = 11, AircraftLoaded = 12, FlightLoaded = 13, PositionChanged = 14, CrashReset = 15 }
    private readonly object gate = new object();
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 2000 };
    private readonly Task transport;
    private SimConnect sim;
    private bool connected;
    private object telemetry;
    private string generation;
    private string aircraftId;
    private bool? running, paused;
    private bool? slew;
    private uint sampleRequest = 100;
    private bool subscribed;
    private bool sampleRequestActive;
    private DateTime lastResponse;
    private DateTime nextAttempt;
    private DateTime nextWaitLog;

    public BridgeWindow(BridgeConfiguration configuration)
    {
        this.configuration = configuration;
        var handle = Handle; // Force creation before starting message dispatch.
        timer.Tick += (sender, args) => Tick();
        timer.Start();
        transport = Task.Run(() => PublishLoop(stop.Token));
        Tick();
    }

    private void Tick()
    {
        try
        {
            if (sim != null)
            {
                if ((DateTime.UtcNow - lastResponse).TotalSeconds > 10)
                {
                    Disconnect("SimConnect response timeout");
                    return;
                }
                if (connected) sim.RequestSystemState(RequestId.Health, "Sim");
                return;
            }
            if (DateTime.UtcNow < nextAttempt) return;
            var connection = new SimConnect("Pax telemetry bridge", Handle, SimMessage, null, 0);
            sim = connection;
            lastResponse = DateTime.UtcNow;
            sim.OnRecvOpen += (sender, data) => {
                if (!ReferenceEquals(sim, connection)) return;
                lock (gate) { connected = true; generation = Guid.NewGuid().ToString(); }
                lastResponse = DateTime.UtcNow;
                Program.Log("SIMCONNECT", "Connected to MSFS");
                Subscribe();
            };
            sim.OnRecvQuit += (sender, data) => { if (ReferenceEquals(sim, connection)) Disconnect("Simulator quit"); };
            sim.OnRecvException += (sender, data) => {
                if (ReferenceEquals(sim, connection)) Disconnect("SDK exception " + data.dwException + " sendId=" + data.dwSendID + " index=" + data.dwIndex);
            };
            sim.OnRecvSystemState += (sender, data) => {
                if (!ReferenceEquals(sim, connection)) return;
                lastResponse = DateTime.UtcNow;
                // Used for health only; ordered subscribed events own simulation state.
            };
            sim.OnRecvEvent += (sender, data) => {
                if (!ReferenceEquals(sim, connection)) return;
                if (data.uEventID == (uint)EventId.Sim && running != (data.dwData != 0)) {
                    RestartSamples("Simulation running state changed", runningState: data.dwData != 0);
                } else if (data.uEventID == (uint)EventId.Pause && paused != (data.dwData != 0)) {
                    RestartSamples("Pause state changed", pauseState: data.dwData != 0);
                } else if (IsLoadEvent(data.uEventID)) RestartSamples("Flight continuity changed");
            };
            sim.OnRecvEventFilename += (sender, data) => {
                if (ReferenceEquals(sim, connection) && IsLoadEvent(data.uEventID)) RestartSamples("Aircraft or flight loaded");
            };
            sim.OnRecvSimobjectData += (sender, data) => {
                if (!ReferenceEquals(sim, connection) || data.dwRequestID != sampleRequest) return;
                lastResponse = DateTime.UtcNow;
                var raw = (RawTelemetry)data.dwData[0];
                var title = (raw.Title ?? "").Trim();
                if (title.Length == 0) title = null;
                lock (gate) {
                    if (aircraftId != title || slew != (raw.Slew != 0)) {
                        generation = Guid.NewGuid().ToString();
                        aircraftId = title;
                        slew = raw.Slew != 0;
                        telemetry = null;
                        Program.Log("SIMCONNECT", "Aircraft identity or slew state changed");
                    }
                    if (telemetry == null) Program.Log("SIMCONNECT", "Telemetry subscription active: first sample received");
                    telemetry = new {
                        timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        latitude = raw.Latitude, longitude = raw.Longitude,
                        altitudeMslFeet = raw.Altitude, altitudeAglFeet = raw.Agl,
                        indicatedAirspeedKnots = raw.Airspeed, verticalSpeedFpm = raw.VerticalSpeed,
                        headingTrueDegrees = (raw.Heading % 360 + 360) % 360,
                        onGround = raw.OnGround != 0,
                        gearExtensionPercent = raw.Gear,
                        flapsLeftExtensionPercent = raw.FlapsLeft * 100,
                        flapsRightExtensionPercent = raw.FlapsRight * 100
                    };
                }
            };
        }
        catch (COMException ex) { Disconnect("Waiting for MSFS: " + ex.Message); }
    }

    private void Subscribe()
    {
        // Field order and FLOAT64/STRING256 layout must exactly match RawTelemetry below.
        Add("PLANE LATITUDE", "degrees");
        Add("PLANE LONGITUDE", "degrees");
        Add("PLANE ALTITUDE", "feet");
        Add("PLANE ALT ABOVE GROUND", "feet");
        Add("AIRSPEED INDICATED", "knots");
        Add("VERTICAL SPEED", "feet per minute");
        Add("PLANE HEADING DEGREES TRUE", "degrees");
        Add("SIM ON GROUND", "bool");
        Add("GEAR TOTAL PCT EXTENDED", "percent");
        Add("TRAILING EDGE FLAPS LEFT PERCENT", "percent over 100");
        Add("TRAILING EDGE FLAPS RIGHT PERCENT", "percent over 100");
        Add("IS SLEW ACTIVE", "bool");
        sim.AddToDataDefinition(DefinitionId.Telemetry, "TITLE", "", SIMCONNECT_DATATYPE.STRING256, 0, SimConnect.SIMCONNECT_UNUSED);
        sim.RegisterDataDefineStruct<RawTelemetry>(DefinitionId.Telemetry);
        subscribed = true;
        RestartSamples("SimConnect subscription started");
        sim.SubscribeToSystemEvent(EventId.Sim, "Sim");
        sim.SubscribeToSystemEvent(EventId.Pause, "Pause_EX1");
        sim.SubscribeToSystemEvent(EventId.AircraftLoaded, "AircraftLoaded");
        sim.SubscribeToSystemEvent(EventId.FlightLoaded, "FlightLoaded");
        sim.SubscribeToSystemEvent(EventId.PositionChanged, "PositionChanged");
        sim.SubscribeToSystemEvent(EventId.CrashReset, "CrashReset");
        Program.Log("SIMCONNECT", "Telemetry subscription requested (1 Hz)");
    }

    private static bool IsLoadEvent(uint id) => id == (uint)EventId.AircraftLoaded || id == (uint)EventId.FlightLoaded ||
        id == (uint)EventId.PositionChanged || id == (uint)EventId.CrashReset;

    private void RestartSamples(string reason, bool? runningState = null, bool? pauseState = null)
    {
        lock (gate) {
            if (runningState.HasValue) running = runningState;
            if (pauseState.HasValue) paused = pauseState;
            generation = Guid.NewGuid().ToString(); telemetry = null; aircraftId = null; slew = null;
        }
        if (subscribed && sim != null) {
            if (sampleRequestActive)
                sim.RequestDataOnSimObject((RequestId)sampleRequest, DefinitionId.Telemetry, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                    SIMCONNECT_PERIOD.NEVER, SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT, 0, 0, 0);
            sampleRequest++;
            sim.RequestDataOnSimObject((RequestId)sampleRequest, DefinitionId.Telemetry, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                SIMCONNECT_PERIOD.SECOND, SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT, 0, 0, 0);
            sampleRequestActive = true;
        }
        Program.Log("SIMCONNECT", reason);
    }

    private void Add(string name, string units) => sim.AddToDataDefinition(
        DefinitionId.Telemetry, name, units, SIMCONNECT_DATATYPE.FLOAT64, 0, SimConnect.SIMCONNECT_UNUSED);

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == SimMessage)
        {
            try { sim?.ReceiveMessage(); }
            catch (COMException ex) { Disconnect("Receive failed: " + ex.Message); }
        }
        else base.WndProc(ref message);
    }

    private void Disconnect(string reason)
    {
        var old = sim;
        sim = null;
        bool wasConnected;
        lock (gate) {
            wasConnected = connected; connected = false; telemetry = null;
            generation = null; aircraftId = null; running = paused = slew = null;
        }
        subscribed = false;
        sampleRequestActive = false;
        try { old?.Dispose(); } catch (COMException) { }
        nextAttempt = DateTime.UtcNow.AddSeconds(2);
        if (wasConnected || DateTime.UtcNow >= nextWaitLog)
        {
            Program.Log("SIMCONNECT", reason);
            nextWaitLog = DateTime.UtcNow.AddSeconds(10);
        }
    }

    private string Snapshot()
    {
        lock (gate) return new JavaScriptSerializer().Serialize(new {
            version = 1, type = "bridgeSnapshot", simulatorConnected = connected, telemetry,
            simulation = connected ? new { generation, aircraftId, active = running == true && paused == false && slew == false } : null
        });
    }

    private async Task PublishLoop(CancellationToken cancellation)
    {
        var nextLog = DateTime.MinValue;
        var retryMilliseconds = 2000;
        var jitter = new Random();
        while (!cancellation.IsCancellationRequested)
        {
            using (var socket = new ClientWebSocket())
            {
                if (configuration.Token.Length > 0)
                    socket.Options.SetRequestHeader("Authorization", "Bearer " + configuration.Token);
                try
                {
                    using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
                    {
                        timeout.CancelAfter(75000); // A free hosted service may need time to wake up.
                        await socket.ConnectAsync(configuration.Endpoint, timeout.Token);
                    }
                    Program.Log("BRIDGE", "Connected to TypeScript server");
                    // Receive concurrently so close frames/pings are processed while publishing.
                    using (var session = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
                    {
                        var receive = ReceiveUntilClosed(socket, session.Token);
                        try
                        {
                            while (!cancellation.IsCancellationRequested && !receive.IsCompleted)
                            {
                                byte[] bytes = Encoding.UTF8.GetBytes(Snapshot());
                                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(session.Token))
                                {
                                    timeout.CancelAfter(3000);
                                    await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, timeout.Token);
                                }
                                retryMilliseconds = 2000;
                                await Task.Delay(1000, session.Token);
                            }
                            await receive;
                        }
                        finally
                        {
                            session.Cancel();
                            socket.Abort();
                            try { await receive; } catch (OperationCanceledException) { } catch (WebSocketException) { }
                        }
                    }
                }
                catch (Exception ex) when (ex is WebSocketException || ex is OperationCanceledException)
                {
                    if (!cancellation.IsCancellationRequested && DateTime.UtcNow >= nextLog)
                    {
                        Program.Log("BRIDGE", "Server unavailable; retrying", ex.Message);
                        nextLog = DateTime.UtcNow.AddSeconds(10);
                    }
                }
            }
            try { await Task.Delay(retryMilliseconds + jitter.Next(0, 1000), cancellation); } catch (OperationCanceledException) { break; }
            retryMilliseconds = Math.Min(retryMilliseconds * 2, 30000);
        }
    }

    private static async Task ReceiveUntilClosed(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[1024];
        while (socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
            if (result.MessageType == WebSocketMessageType.Close) return;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Stop(); timer.Dispose();
            stop.Cancel();
            Disconnect("Bridge stopping");
            transport.GetAwaiter().GetResult();
            stop.Dispose();
        }
        base.Dispose(disposing);
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Ansi)]
internal struct RawTelemetry
{
    public double Latitude, Longitude, Altitude, Agl, Airspeed, VerticalSpeed, Heading,
        OnGround, Gear, FlapsLeft, FlapsRight, Slew;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
    public string Title;
}
