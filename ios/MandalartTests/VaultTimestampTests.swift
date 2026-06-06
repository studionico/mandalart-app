import XCTest

/// VaultTimestamp (ISO8601 Date↔String) のユニットテスト。SyncEngine と同形式であることを確認。
final class VaultTimestampTests: XCTestCase {

    func testRoundTrip() {
        let date = Date(timeIntervalSince1970: 1_700_000_000) // 秒精度 (ms=000)
        let string = VaultTimestamp.format(date)
        let parsed = VaultTimestamp.parse(string)
        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed!.timeIntervalSince1970, date.timeIntervalSince1970, accuracy: 0.001)
    }

    func testFormatShape() {
        // epoch 0 を UTC fractional seconds で焼くと "1970-01-01T00:00:00.000Z"。
        XCTAssertEqual(VaultTimestamp.format(Date(timeIntervalSince1970: 0)), "1970-01-01T00:00:00.000Z")
    }

    func testParseKnownString() {
        XCTAssertNotNil(VaultTimestamp.parse("2026-06-02T00:00:00.000Z"))
        // fractional seconds 無しは parse できない (formatOptions に withFractionalSeconds 指定のため)。
        XCTAssertNil(VaultTimestamp.parse("not-a-date"))
    }
}
