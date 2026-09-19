import XCTest
@testable import Ash

final class AshTests: XCTestCase {
    func testServerURLRejectsRemotePlainHTTPAndCredentials() throws {
        XCTAssertThrowsError(try GingerClient.endpoint("http://ginger.example.com"))
        XCTAssertThrowsError(try GingerClient.endpoint("https://user:secret@example.com"))
        XCTAssertThrowsError(try GingerClient.endpoint("https://example.com?token=secret"))
        XCTAssertEqual(try GingerClient.endpoint("https://ginger.example.com").absoluteString, "https://ginger.example.com/api/ash")
        XCTAssertEqual(try GingerClient.endpoint("http://localhost:3003").host, "localhost")
    }
    func testVoiceSetupFailsBeforeNetworkingWithoutToken() throws {
        XCTAssertThrowsError(try GingerClient.makeVoiceRequest("status", address: "http://localhost:3003", token: ""))
        let request = try GingerClient.makeVoiceRequest("status", address: "http://ginger.local:3002", token: String(repeating: "a", count: 48))
        XCTAssertEqual(request.url?.path, "/api/ash/voice/status")
        XCTAssertEqual(request.timeoutInterval, 10)
        XCTAssertEqual(request.httpMethod, "GET")
    }
    func testExerciseAlwaysLabelsSpokenAnswer() {
        for question in ["briefing", "weather", "safe route", "wind"] {
            let reply = AshReply.exercise(question: question)
            XCTAssertEqual(reply.mode, "demo")
            XCTAssertTrue(reply.answer.hasPrefix("Exercise only."))
            XCTAssertFalse(reply.isStale)
        }
    }
    func testServerTimestampsWithFractionalSecondsAreParsed() throws {
        let reply = AshReply(mode: "connected", topic: "Weather", answer: "Known facts", generatedAt: "2026-09-19T12:00:00.123Z", weather: nil, hotspots: nil, sources: [], missing: [])
        XCTAssertNotNil(reply.date)
        let old = AshReply(mode: "connected", topic: "Weather", answer: "Old facts", generatedAt: "2020-01-01T00:00:00Z", weather: nil, hotspots: nil, sources: [], missing: [])
        XCTAssertTrue(old.isStale)
    }
    @MainActor func testAddressedSpeechOnly() {
        XCTAssertEqual(VoiceController.addressedQuestion("Ash, what is nearby?"), "what is nearby")
        XCTAssertEqual(VoiceController.addressedQuestion("Hey Ash stop listening."), "stop listening")
        XCTAssertNil(VoiceController.addressedQuestion("There is ash on the road"))
        XCTAssertNil(VoiceController.addressedQuestion("How is the wind?"))
    }
    func testGPSAgeAndAccuracy() {
        let fresh = PositionFix(lat: 41.3, lon: 1.86, accuracyM: 8, observedAt: ISO8601DateFormatter().string(from: Date()), source: "ios-core-location")
        XCTAssertTrue(fresh.isFresh)
        let old = PositionFix(lat: 41.3, lon: 1.86, accuracyM: 8, observedAt: "2020-01-01T00:00:00Z", source: "ios-core-location")
        XCTAssertFalse(old.isFresh)
    }
    @MainActor func testChangingContextClearsPreviousConversationAndEvidence() async {
        let store = AshStore()
        store.question = "previous question"
        store.demo = false
        store.resetContext()
        XCTAssertNil(store.reply)
        XCTAssertTrue(store.turns.isEmpty)
        XCTAssertEqual(store.question, "")
        XCTAssertFalse(store.loading)
    }
}
