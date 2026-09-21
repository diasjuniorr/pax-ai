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
            if (args.Length != 0) throw new ArgumentException("Usage: PaxAgent.exe [--check-runtime]");
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            using (var window = new BridgeWindow())
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

internal sealed class BridgeWindow : Control
{
    private const int SimMessage = 0x0402;
    private enum DefinitionId : uint { Telemetry = 1 }
    private enum RequestId : uint { Telemetry = 2, Health = 3 }
    private readonly object gate = new object();
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 2000 };
    private readonly Task transport;
    private SimConnect sim;
    private bool connected;
    private object telemetry;
    private DateTime lastResponse;
    private DateTime nextAttempt;
    private DateTime nextWaitLog;

    public BridgeWindow()
    {
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
            sim = new SimConnect("Pax telemetry bridge", Handle, SimMessage, null, 0);
            lastResponse = DateTime.UtcNow;
            sim.OnRecvOpen += (sender, data) => {
                lock (gate) connected = true;
                lastResponse = DateTime.UtcNow;
                Program.Log("SIMCONNECT", "Connected to MSFS");
                Subscribe();
            };
            sim.OnRecvQuit += (sender, data) => Disconnect("Simulator quit");
            sim.OnRecvException += (sender, data) => Disconnect(
                "SDK exception " + data.dwException + " sendId=" + data.dwSendID + " index=" + data.dwIndex);
            sim.OnRecvSystemState += (sender, data) => { lastResponse = DateTime.UtcNow; };
            sim.OnRecvSimobjectData += (sender, data) => {
                if (data.dwRequestID != (uint)RequestId.Telemetry) return;
                lastResponse = DateTime.UtcNow;
                var raw = (RawTelemetry)data.dwData[0];
                if (telemetry == null) Program.Log("SIMCONNECT", "Telemetry subscription active: first sample received");
                lock (gate) telemetry = new {
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
            };
        }
        catch (COMException ex) { Disconnect("Waiting for MSFS: " + ex.Message); }
    }

    private void Subscribe()
    {
        // Field order and FLOAT64 layout must exactly match RawTelemetry below.
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
        sim.RegisterDataDefineStruct<RawTelemetry>(DefinitionId.Telemetry);
        sim.RequestDataOnSimObject(RequestId.Telemetry, DefinitionId.Telemetry, SimConnect.SIMCONNECT_OBJECT_ID_USER,
            SIMCONNECT_PERIOD.SECOND, SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT, 0, 0, 0);
        Program.Log("SIMCONNECT", "Telemetry subscription requested (1 Hz)");
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
        lock (gate) { wasConnected = connected; connected = false; telemetry = null; }
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
            version = 1, type = "bridgeSnapshot", simulatorConnected = connected, telemetry
        });
    }

    private async Task PublishLoop(CancellationToken cancellation)
    {
        var nextLog = DateTime.MinValue;
        while (!cancellation.IsCancellationRequested)
        {
            using (var socket = new ClientWebSocket())
            {
                try
                {
                    using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
                    {
                        timeout.CancelAfter(3000);
                        await socket.ConnectAsync(new Uri("ws://127.0.0.1:3001/bridge"), timeout.Token);
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
            try { await Task.Delay(2000, cancellation); } catch (OperationCanceledException) { break; }
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

[StructLayout(LayoutKind.Sequential, Pack = 1)]
internal struct RawTelemetry
{
    public double Latitude, Longitude, Altitude, Agl, Airspeed, VerticalSpeed, Heading,
        OnGround, Gear, FlapsLeft, FlapsRight;
}
