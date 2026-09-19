import SwiftUI
import MapKit

private let ember = Color(red: 1, green: 0.36, blue: 0.18)
private let canvas = Color(red: 0.045, green: 0.052, blue: 0.055)
private let panel = Color(red: 0.085, green: 0.094, blue: 0.10)

struct AshRootView: View {
    @Environment(AshStore.self) private var store
    @Environment(\.scenePhase) private var phase
    @State private var radio = CrewRadio()
    @State private var settings = false
    var body: some View {
        @Bindable var store = store
        TabView(selection: $store.tab) {
            Tab("Field", systemImage: "scope", value: 0) { NavigationStack { FieldView(settings: $settings) } }
            Tab("Ask Ash", systemImage: "waveform", value: 1) { NavigationStack { AskView() } }
            Tab("Crew", systemImage: "person.2.wave.2", value: 2) { NavigationStack { CrewView(radio: radio) } }
        }
        .tint(ember)
        .sheet(isPresented: $settings) { SettingsView() }
        .onChange(of: store.tab) { old, new in if new == 2 { store.endSession() }; if old == 2 { radio.stopAudio() } }
        .onChange(of: phase) { if phase == .background { radio.disable(); if !store.voice.active { store.location.stop() } } }
        .onChange(of: store.demo) { store.resetContext() }
        .onChange(of: store.useGPS) { store.resetContext() }
        .onChange(of: store.sector) { store.resetContext() }
    }
}
private struct Eyebrow: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.system(.caption2, design: .monospaced, weight: .semibold)).tracking(2).foregroundStyle(.secondary) }
}
private struct ModeLabel: View {
    let demo: Bool
    var body: some View { Label(demo ? "EXERCISE" : "GINGER", systemImage: demo ? "circle.dotted" : "link").font(.system(.caption2, design: .monospaced, weight: .bold)).tracking(1).padding(.horizontal, 10).padding(.vertical, 7).background(ember.opacity(0.12), in: Capsule()).foregroundStyle(ember) }
}
private struct AshCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View { content.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(panel, in: RoundedRectangle(cornerRadius: 22)) }
}
struct FieldView: View {
    @Environment(AshStore.self) private var store
    @Binding var settings: Bool
    @State private var currentTime = Date()
    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .center) {
                    HStack(spacing: 8) { Image(systemName: "waveform.path").font(.title).foregroundStyle(ember); Text("ash").font(.system(size: 38, weight: .bold, design: .rounded)).tracking(-2) }
                    Spacer(); ModeLabel(demo: store.demo)
                    Button("Connection settings", systemImage: "slider.horizontal.3") { settings = true }.labelStyle(.iconOnly).frame(width: 44, height: 44).foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 7) { Eyebrow(text: "Ginger intelligence. In your ear."); Text("Eyes up.\nStay informed.").font(.system(size: 39, weight: .semibold)).tracking(-1.4) }
                HStack {
                    Label("FIELD CONTEXT", systemImage: "location.viewfinder").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer()
                    Picker("Sector", selection: $store.sector) { ForEach(store.demo ? [Sector.all[0]] : Sector.all) { sector in Text(sector.name).tag(sector) } }.tint(.white)
                }
                if store.useGPS && !store.demo && store.location.fix == nil {
                    AshCard { Label("Waiting for your GPS fix. No sector substituted.", systemImage: "location.slash").font(.subheadline) }
                } else {
                    SectorMap(sector: store.contextSector, demo: store.demo).frame(height: 180).clipShape(.rect(cornerRadius: 22))
                }
                if let reply = store.reply {
                    let stale = reply.mode != "demo" && (reply.date.map { currentTime.timeIntervalSince($0) > 600 } ?? true)
                    HStack(spacing: 10) {
                        MetricView(icon: "wind", value: reply.weather.map { String(format: "%.0f", $0.windKmh) } ?? "—", unit: "km/h · wind")
                        MetricView(icon: "humidity", value: reply.weather.map { String(format: "%.0f", $0.humidityPct) } ?? "—", unit: "% · humidity")
                        MetricView(icon: "viewfinder", value: reply.hotspots.map(String.init) ?? "—", unit: "detections")
                    }.opacity(stale ? 0.45 : 1)
                    AshCard {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack { Eyebrow(text: "Your briefing"); Spacer(); Image(systemName: "waveform").foregroundStyle(ember) }
                            Text(reply.answer).font(.subheadline).foregroundStyle(.white.opacity(0.9)).lineSpacing(4)
                            HStack {
                                Text(reply.mode == "demo" ? "SIMULATED · NOT LIVE" : stale ? "STALE · REFRESH REQUIRED" : "SOURCE DETAILS BELOW").font(.system(.caption2, design: .monospaced)).foregroundStyle(ember)
                                Spacer()
                                Button(store.voice.speaking ? "Stop" : "Listen", systemImage: store.voice.speaking ? "stop.fill" : "play.fill") { if store.voice.speaking { store.voice.stopAll() } else { store.voice.speak((stale ? "Stale briefing. " : "") + reply.answer, address: store.server, token: store.token) } }.font(.caption.weight(.semibold))
                            }
                        }
                    }
                    if let position = reply.position {
                        AshCard { VStack(alignment: .leading, spacing: 8) { Eyebrow(text: position.isFresh ? "GPS context · not DGPS" : "Old GPS context · refresh required"); Text(String(format: "%.5f, %.5f · ±%.0f m", position.lat, position.lon, position.accuracyM)).font(.subheadline.monospaced()); Text(position.observedAt).font(.caption).foregroundStyle(.secondary) } }
                    }
                    if let situation = reply.situation {
                        AshCard { VStack(alignment: .leading, spacing: 12) {
                            Eyebrow(text: "Nearby Ginger situation")
                            Text(situation.scope).font(.caption).foregroundStyle(.secondary)
                            ForEach(situation.observations) { observation in Text("Unverified · \(observation.distanceM) m: \(observation.text)").font(.subheadline) }
                            ForEach(situation.tasks) { task in Text("\(task.status) · \(task.distanceM) m: \(task.title)").font(.subheadline) }
                            Text(situation.dgps.reason).font(.caption).foregroundStyle(ember)
                        } }
                    }
                    SourcesView(reply: reply)
                } else {
                    AshCard { VStack(alignment: .leading, spacing: 12) { Text("Connect your field context").font(.headline); Text("Refresh to request Ginger’s current evidence for \(store.sector.name).").foregroundStyle(.secondary) } }
                }
                if let error = store.error ?? store.voice.error { Text(error).font(.callout).foregroundStyle(ember) }
                Button { store.ask("Give me the current briefing") } label: { Label(store.loading ? "Checking Ginger…" : "Refresh briefing", systemImage: "arrow.clockwise").frame(maxWidth: .infinity).padding(10) }.buttonStyle(.bordered).disabled(store.loading || store.voice.active)
                Text(store.useGPS && !store.demo ? "Phone GPS context. Accuracy and age are shown with the answer; differential corrections are unavailable." : "Selected sector, not your GPS location. Ash does not issue dispatch or evacuation instructions.").font(.caption).foregroundStyle(.secondary)
            }.padding(22)
        }
        .background(canvas)
        .safeAreaInset(edge: .bottom) {
            Button { store.tab = 1 } label: {
                HStack { Image(systemName: "waveform").font(.title2); VStack(alignment: .leading, spacing: 3) { Text("Talk to Ash").font(.headline); Text("A question away from your context").font(.caption).opacity(0.75) }; Spacer(); Image(systemName: "arrow.up.right") }.padding(18).foregroundStyle(.white).background(ember, in: RoundedRectangle(cornerRadius: 20))
            }.padding(.horizontal, 22).padding(.vertical, 10).background(canvas.opacity(0.96))
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            currentTime = Date()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                currentTime = Date()
            }
        }
    }
}
private struct MetricView: View {
    let icon: String; let value: String; let unit: String
    var body: some View { VStack(alignment: .leading, spacing: 9) { Image(systemName: icon).foregroundStyle(.secondary); Text(value).font(.system(.title, design: .rounded, weight: .medium)); Text(unit).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(14).background(panel, in: .rect(cornerRadius: 18)).accessibilityElement(children: .combine) }
}
private struct SectorMap: View {
    let sector: Sector; let demo: Bool
    var body: some View {
        Map(initialPosition: .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: sector.lat, longitude: sector.lon), span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.13)))) {
            Annotation(sector.name, coordinate: CLLocationCoordinate2D(latitude: sector.lat, longitude: sector.lon)) {
                Image(systemName: "scope").font(.title).foregroundStyle(ember).padding(12).background(.black.opacity(0.7), in: Circle())
            }
        }.id(sector.id).mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll)).mapControls { MapCompass() }
            .overlay(alignment: .topLeading) { Text(demo ? "GARRAF · EXERCISE AREA" : "\(sector.name.uppercased()) · SELECTED AREA").font(.system(.caption2, design: .monospaced)).padding(10).background(.black.opacity(0.75), in: Capsule()).padding(12) }
            .accessibilityLabel("Map of selected \(sector.name) sector. No fire perimeter or route shown.")
    }
}
private struct SourcesView: View {
    let reply: AshReply
    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(reply.sources) { source in VStack(alignment: .leading, spacing: 5) { Text(source.source).font(.subheadline.weight(.semibold)); Text("\(source.status.uppercased()) · \(source.retrievedAt)").font(.caption2.monospaced()).foregroundStyle(ember); Text(source.detail).font(.caption).foregroundStyle(.secondary) } }
                Text("Missing: " + reply.missing.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 12)
        } label: { Label("Evidence & limitations", systemImage: "text.document").font(.subheadline).foregroundStyle(.secondary) }
    }
}
struct AskView: View {
    @Environment(AshStore.self) private var store
    @State private var autoSpeak = true
    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack { Eyebrow(text: "SLNG voice session"); Spacer(); ModeLabel(demo: store.demo) }
                Text(store.voice.active ? "Eyes up.\nVoice session on." : "Your voice.\nGinger’s context.").font(.system(size: 38, weight: .semibold)).tracking(-1.2)
                AshCard {
                    VStack(alignment: .leading, spacing: 16) {
                        Label(store.voice.active ? "Microphone on" : "Session stopped", systemImage: store.voice.active ? "mic.fill" : "mic.slash").font(.title3.weight(.semibold)).foregroundStyle(ember)
                        Text(store.voice.preparing ? store.voice.preparationMessage : store.voice.speaking ? "Ash is speaking" : store.voice.processing ? "Checking Ginger…" : store.voice.active ? "Say ‘Ash’, then your question. Turns are submitted automatically." : "Start once to keep the microphone on, including with the screen locked. No Siri or stem press required.").font(.subheadline)
                        Text("Speech segments go to SLNG through Ginger. Non-addressed speech is transcribed but does not trigger an answer. Say ‘Ash, stop listening’ to end.").font(.caption).foregroundStyle(.secondary)
                        Button {
                            if store.voice.active || store.voice.preparing { store.endSession() }
                            else { Task { await store.startSession() } }
                        } label: { Label(store.voice.active || store.voice.preparing ? "End voice session" : "Start voice session", systemImage: store.voice.active ? "stop.fill" : "waveform").font(.headline).frame(maxWidth: .infinity).padding(16).background(ember, in: .rect(cornerRadius: 16)).foregroundStyle(.white) }
                        Text(store.voice.route).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Toggle("Use my GPS position", isOn: $store.useGPS).disabled(store.demo)
                if let fix = store.location.fix { Text(String(format: "GPS %.5f, %.5f · ±%.0f m", fix.lat, fix.lon, fix.accuracyM)).font(.caption.monospaced()) }
                if let error = store.location.error { Text(error).font(.caption).foregroundStyle(ember) }
                Text("One AirPod can carry mic and reply audio. A split pair is one shared audio connection, not two independent unit radios.").font(.caption).foregroundStyle(.secondary)
                if let error = store.error ?? store.voice.error { Text(error).foregroundStyle(ember).font(.callout) }
                if !store.voice.transcript.isEmpty { AshCard { VStack(alignment: .leading, spacing: 8) { Eyebrow(text: "Last heard"); Text(store.voice.transcript).font(.subheadline) } } }
                if !store.voice.active {
                    TextField("Or type your question…", text: $store.question, axis: .vertical).lineLimit(2...5).padding(16).background(panel, in: .rect(cornerRadius: 16)).accessibilityIdentifier("questionInput")
                    Button { store.ask(store.question, spoken: autoSpeak) } label: { Label(store.loading ? "Checking Ginger…" : "Ask Ash", systemImage: "arrow.up").frame(maxWidth: .infinity).padding(16) }.buttonStyle(.borderedProminent).disabled(store.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.question.count > 500 || store.loading).accessibilityIdentifier("submitQuestion")
                    Toggle("Read typed answers through SLNG", isOn: $autoSpeak).font(.subheadline)
                }
                if store.voice.speaking && !store.voice.active { Button("Stop speaking", systemImage: "stop.circle") { store.voice.stopAll() } }
                if store.turns.isEmpty {
                    ForEach(["Give me the current briefing", "What is the wind doing?", "What observations are nearby?"], id: \.self) { text in Button { store.question = text } label: { HStack { Text(text); Spacer(); Image(systemName: "arrow.up.left") }.font(.subheadline).foregroundStyle(.white).padding(15).background(panel, in: .rect(cornerRadius: 14)) }.disabled(store.voice.active) }
                }
                ForEach(store.turns.reversed()) { turn in
                    AshCard { VStack(alignment: .leading, spacing: 14) { Text(turn.question).font(.headline); Label("ASH · \(turn.reply.mode.uppercased())", systemImage: "waveform").font(.caption2.monospaced()).foregroundStyle(ember); Text(turn.reply.answer).font(.subheadline).lineSpacing(4); SourcesView(reply: turn.reply) } }
                }
            }.padding(22)
        }.background(canvas).navigationTitle("Ask Ash").navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: store.voice.active)
    }
}
struct CrewView: View {
    @Bindable var radio: CrewRadio
    @State private var browsing = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Eyebrow(text: "The team, within reach")
                Text("One crew.\nEvery voice.").font(.system(size: 38, weight: .semibold)).tracking(-1.2)
                Text("Nearby voice messages over local Wi-Fi or Bluetooth. Keep Ash open on both phones.").foregroundStyle(.secondary).font(.subheadline)
                AshCard { VStack(alignment: .leading, spacing: 16) {
                    HStack { Label("Nearby crew", systemImage: "antenna.radiowaves.left.and.right"); Spacer(); Text(radio.enabled ? "DISCOVERABLE" : "OFFLINE").font(.caption2.monospaced()).foregroundStyle(ember) }
                    Text("Your name: \(radio.peerID.displayName)").font(.caption).foregroundStyle(.secondary)
                    Button(radio.enabled ? "Leave crew" : "Enable nearby crew") { if radio.enabled { radio.disable() } else { radio.enable() } }.buttonStyle(.borderedProminent)
                    if radio.enabled { Button("Find teammates", systemImage: "person.badge.plus") { browsing = true } }
                } }
                if radio.peers.isEmpty { ContentUnavailableView("No teammates connected", systemImage: "person.2", description: Text("Enable nearby crew on a second iPhone, then find and invite it. Peer names are not verified identities.")) }
                else {
                    ForEach(radio.peers, id: \.self) { peer in Label(peer, systemImage: "person.crop.circle.badge.checkmark").font(.headline) }
                    Button {
                        if radio.recording { radio.sendRecording() } else { Task { await radio.beginRecording() } }
                    } label: { Label(radio.preparing ? "Preparing…" : radio.recording ? "Send voice message" : "Record for crew", systemImage: radio.recording ? "paperplane.fill" : "mic.fill").font(.headline).frame(maxWidth: .infinity).padding(20).background(ember, in: .rect(cornerRadius: 18)).foregroundStyle(.white) }.disabled(radio.preparing)
                    if radio.recording { Button("Discard recording", role: .cancel) { radio.cancelRecording() }; Text("Recording · 30-second maximum").font(.caption).foregroundStyle(ember) }
                }
                if let error = radio.error { Text(error).font(.callout).foregroundStyle(ember) }
                ForEach(radio.messages) { message in
                    Button { radio.play(message) } label: { AshCard { HStack(spacing: 15) { Image(systemName: "play.circle.fill").font(.title).foregroundStyle(ember); VStack(alignment: .leading, spacing: 5) { Text(message.sender).font(.headline); Text(message.receipt).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(message.date, style: .time).font(.caption2).foregroundStyle(.secondary) } } }.foregroundStyle(.white)
                }
                Text("Messages are encrypted in transit and kept in memory for this session. This is a foreground voice-message channel; background radio and remote dispatch are not connected.").font(.caption).foregroundStyle(.secondary)
            }.padding(22)
        }.background(canvas).navigationTitle("Crew").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $browsing) { CrewBrowser(radio: radio) }
        .alert("Crew invitation", isPresented: Binding(get: { radio.invitation != nil }, set: { if !$0 { radio.respond(false) } })) { Button("Accept") { radio.respond(true) }; Button("Decline", role: .cancel) { radio.respond(false) } } message: { Text("\(radio.invitation ?? "A nearby device") wants to connect. Confirm this name with your teammate.") }
    }
}
struct SettingsView: View {
    @Environment(AshStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var validation: String?
    @State private var accessToken = ""
    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section("Ginger connection") {
                    Toggle("Exercise mode", isOn: $store.demo)
                    TextField("Ginger server URL", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("Ash access token (not the SLNG key)", text: $accessToken).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save connection") {
                        do { _ = try GingerClient.endpoint(address); try AshCredentials.save(accessToken, for: address); store.server = address; UserDefaults.standard.set(address, forKey: "gingerServer"); store.resetContext(); validation = "Connection saved. Refresh Field to check the server." }
                        catch { validation = error.localizedDescription }
                    }
                    if let validation { Text(validation).font(.caption) }
                    Text("Use your Ginger HTTPS server, or localhost:3003 in the simulator. Exercise mode uses a bundled Garraf scenario.").font(.caption)
                }
                Section("AirPods & continuous listening") {
                    Label("One AirPod · mono voice", systemImage: "airpodspro")
                    Text("Set the AirPods microphone to Automatically Switch AirPods in iPhone Settings. With one earbud in use, that earbud supplies the microphone.")
                    Text("Start a voice session once. Ash keeps its microphone active until you end the session or audio is interrupted. No Siri shortcut is installed.")
                    Text("Splitting one pair between two people does not provide two independent microphones or two unit connections. Each independent unit needs its own connected phone/headset.").font(.caption)
                }
                Section("SLNG voice engine") {
                    LabeledContent("Input", value: "Nova 3 · English")
                    LabeledContent("Output", value: "Aura 2 · English")
                    Button("Check server configuration") { Task { do { try await GingerClient.checkVoice(address: store.server, token: store.token); validation = "Server configured. A real speech turn is needed to verify SLNG credentials." } catch { validation = error.localizedDescription } } }
                    Text("SLNG_API_KEY stays on the server. The separate Ash token is stored in this phone’s Keychain. The default English hosted models use SLNG’s US East gateway.").font(.caption)
                }
                Section("Position context") {
                    Toggle("Use current phone GPS", isOn: $store.useGPS).disabled(store.demo)
                    Text("Fresh GPS fixes include timestamp and horizontal accuracy. Ginger adds nearby evidence and operator observations. No DGPS corrections or receiver are configured.").font(.caption)
                }
                Section("About") { Text("ASH / 0.1\nField companion to Ginger").font(.subheadline); Text("Prototype · source-backed decision support. No verified dispatch, crew tracking, evacuation or fire spread service.").font(.caption) }
            }.navigationTitle("Connection").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.onAppear { address = store.server; accessToken = store.token }.tint(ember)
    }
}
