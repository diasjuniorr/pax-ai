# Trip types and travel reasons

Choose **Trip type** before clicking **Generate passenger**:

- Sightseeing flight (`sightseeing`)
- Light cargo (`light-cargo`)
- VIP executive flight (`vip-executive`)
- VIP special event / guest (`vip-special-event`)

Generation selects a starter passenger and one of ten locally authored reasons for the selected type. Each reason gives a concrete purpose and a personal motivation or attitude. Light-cargo reasons describe a person accompanying the shipment, not an unoccupied cargo-only flight. No real booking, venue, event date or airport is claimed. Reasons stay editable and retain the existing 400-character limit. Repeated generation can select the same reason.

Changing the dropdown alone does not overwrite a manually edited reason. Click Generate passenger to generate again; this replaces the profile fields as before. Once a session starts, the type and reason are locked with the rest of its profile. Refresh restores both. End the session to edit them.

`tripType` belongs to the flight session, and the shared context builder supplies it to both text and voice. Older API clients omitting it default to sightseeing. Unknown trip types are rejected. The generation endpoint accepts `{ "tripType": "light-cargo" }`; an empty object remains compatible.

## Extension direction (not implemented)

The catalog lives separately in `apps/server/src/trip-reasons.ts`. Keep the resulting editable reason/profile contract stable as additional sources are introduced:

1. Replace/augment catalog selection with persisted user-authored records, organized by stable trip-type IDs. Add database editing and source/provenance fields when needed.
2. Add an explicit AI-generation toggle. Off uses the local/database catalog; on invokes a server-side generator using the configured API key and bounded validated context. Do not make incidental dropdown changes incur charges. Define failure fallback and preview/edit behavior before enabling it.
3. Enrich that generator with explicitly sourced real-world information and user-provided local details, with freshness and provenance. Fictional motivations must remain distinguishable from verified facts.
4. Investigate simulator flight-plan integration for actual departure/destination airports. Present telemetry coordinates alone cannot establish a planned destination; nearest-airport inference must not silently overwrite the user's route. Preserve manual airport fields until a verified source is implemented.

No new database, AI-generation request, provider toggle or simulator contract is introduced in this increment. The existing OpenAI key is used for conversation only; passenger/reason generation remains free local selection.
