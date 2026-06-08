import XCTest
@testable import Mandalart

/// ローカル JSON ミラーのファイル名生成 (`MirrorFilename`) を検証する。
/// desktop [`mirrorFilename.test.ts`](../../desktop/src/lib/mirror/__tests__/mirrorFilename.test.ts) と parity。
final class MirrorFilenameTests: XCTestCase {

    func testSlugNormalTitle() {
        XCTAssertEqual(MirrorFilename.slug("健康"), "健康")
        XCTAssertEqual(MirrorFilename.slug("My Goal"), "My-Goal")
    }

    func testSlugCollapsesWhitespace() {
        XCTAssertEqual(MirrorFilename.slug("a   b"), "a-b")
    }

    func testSlugStripsUnsafeChars() {
        XCTAssertEqual(MirrorFilename.slug("a/b\\c:d*e?f\"g<h>i|j"), "a-b-c-d-e-f-g-h-i-j")
    }

    func testSlugEmptyFallsBackToUntitled() {
        XCTAssertEqual(MirrorFilename.slug(""), "untitled")
        XCTAssertEqual(MirrorFilename.slug("   "), "untitled")
        XCTAssertEqual(MirrorFilename.slug("///"), "untitled")
    }

    func testSlugStripsLeadingTrailingHyphens() {
        XCTAssertEqual(MirrorFilename.slug("  -hello-  "), "hello")
    }

    func testFilenameShape() {
        XCTAssertEqual(MirrorFilename.make(title: "健康", id: "abc-123"), "健康-abc-123.json")
        XCTAssertEqual(MirrorFilename.make(title: "", id: "id1"), "untitled-id1.json")
    }
}
