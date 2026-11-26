import Foundation

/// Op streams shaped like the channel list: a screen, one section, and rows of an item with a
/// text child. Ids: 1 screen, 2 section, rows from 3 (item 3 + 2i, its text 4 + 2i).
enum Fixture {
    static func rowId(_ index: Int) -> Int { 3 + 2 * index }

    static func mount(rows: Int, seq: Int = 1) -> Data {
        var ops: [String] = [
            #"["create",1,"hz:screen"]"#, #"["props",1,{"title":"Channels"}]"#,
            #"["create",2,"hz:section"]"#, #"["props",2,{"title":"All channels"}]"#,
        ]
        ops.reserveCapacity(rows * 6 + 6)
        for i in 0..<rows {
            let item = rowId(i), text = item + 1
            ops.append(#"["create",\#(item),"hz:item"]"#)
            ops.append(#"["props",\#(item),{"title":"channel-\#(i)","subtitle":"last message \#(i)","badge":\#(i % 5),"isSelected":false}]"#)
            ops.append(#"["events",\#(item),["press"]]"#)
            ops.append(#"["create",\#(text),"hz:text"]"#)
            ops.append(#"["text",\#(text),"preview \#(i)"]"#)
            ops.append(#"["insert",\#(item),\#(text),null]"#)
            ops.append(#"["insert",2,\#(item),null]"#)
        }
        ops.append(#"["insert",1,2,null]"#)
        ops.append(#"["insert",0,1,null]"#)
        return batch(seq: seq, ops: ops)
    }

    static func badge(row: Int, value: Int, seq: Int) -> Data {
        batch(seq: seq, ops: [#"["props",\#(rowId(row)),{"badge":\#(value)}]"#])
    }

    static func batch(seq: Int, ops: [String]) -> Data {
        Data(#"{"v":1,"seq":\#(seq),"ops":[\#(ops.joined(separator: ","))]}"#.utf8)
    }
}
