import test from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_EXPORT_BASE_NAME,
    findFirstHeading,
    pickExportBaseName,
    sanitizeFileName,
    stripInlineMarkdown,
    stripMarkdownExtension,
} from "./exportFileName.ts";

test("sanitizeFileName 保留空格与连字符", () => {
    assert.equal(sanitizeFileName("我的报告-v2 终稿"), "我的报告-v2 终稿");
});

test("sanitizeFileName 去掉各平台非法字符", () => {
    assert.equal(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j'), "abcdefghij");
});

test("sanitizeFileName 去掉控制字符", () => {
    // 用 fromCharCode 构造，避免源码里出现裸控制字节
    const withControls = "ab" + String.fromCharCode(0) + "c" + String.fromCharCode(31) + "d";
    assert.equal(sanitizeFileName(withControls), "abcd");
});

test("sanitizeFileName 压缩连续空白为单个空格", () => {
    assert.equal(sanitizeFileName("a   b\t\tc"), "a b c");
});

test("sanitizeFileName 去掉结尾的点与空格（Windows 不接受）", () => {
    assert.equal(sanitizeFileName("报告..."), "报告");
    assert.equal(sanitizeFileName("报告   "), "报告");
});

test("sanitizeFileName 拒绝 Windows 保留设备名", () => {
    assert.equal(sanitizeFileName("CON"), "");
    assert.equal(sanitizeFileName("com1"), "");
    assert.equal(sanitizeFileName("LPT9"), "");
    // 只是以保留名开头则不受影响
    assert.equal(sanitizeFileName("console"), "console");
});

test("sanitizeFileName 全是非法字符时返回空串", () => {
    assert.equal(sanitizeFileName('<>:"/\\|?*'), "");
});

test("sanitizeFileName 截断到 120 字符", () => {
    assert.equal(sanitizeFileName("x".repeat(200)).length, 120);
});

test("stripMarkdownExtension 只去掉 markdown 类扩展名", () => {
    assert.equal(stripMarkdownExtension("文档A.md"), "文档A");
    assert.equal(stripMarkdownExtension("a.b.md"), "a.b");
    assert.equal(stripMarkdownExtension("note.MARKDOWN"), "note");
    assert.equal(stripMarkdownExtension("readme.txt"), "readme");
    // 非 markdown 扩展名原样保留
    assert.equal(stripMarkdownExtension("report.v2"), "report.v2");
    assert.equal(stripMarkdownExtension("chart.png"), "chart.png");
});

test("stripInlineMarkdown 去掉强调与代码标记，保留下划线", () => {
    assert.equal(stripInlineMarkdown("**加粗标题**"), "加粗标题");
    assert.equal(stripInlineMarkdown("`代码`标题"), "代码标题");
    assert.equal(stripInlineMarkdown("~~删除线~~"), "删除线");
    assert.equal(stripInlineMarkdown("my_report"), "my_report");
});

test("stripInlineMarkdown 链接与图片只留文字", () => {
    assert.equal(stripInlineMarkdown("[文颜](https://example.com)"), "文颜");
    assert.equal(stripInlineMarkdown("![图](a.png)"), "图");
});

test("findFirstHeading 取首个标题", () => {
    assert.equal(findFirstHeading("# 第一\n\n## 第二"), "第一");
});

test("findFirstHeading 支持任意层级作为首个标题", () => {
    assert.equal(findFirstHeading("正文\n\n### 三级标题\n"), "三级标题");
});

test("findFirstHeading 兼容闭合式 ATX 写法", () => {
    assert.equal(findFirstHeading("# 标题 #"), "标题");
});

test("findFirstHeading 跳过围栏代码块内的 #", () => {
    const markdown = ["```bash", "# 这是注释不是标题", "echo hi", "```", "", "# 真标题"].join("\n");
    assert.equal(findFirstHeading(markdown), "真标题");
});

test("findFirstHeading 波浪号围栏同样跳过", () => {
    const markdown = ["~~~python", "# 注释", "~~~", "## 真标题"].join("\n");
    assert.equal(findFirstHeading(markdown), "真标题");
});

test("findFirstHeading 不把 # 后缺空格的行当标题", () => {
    assert.equal(findFirstHeading("#没有空格\n"), null);
});

test("findFirstHeading 无标题时返回 null", () => {
    assert.equal(findFirstHeading("只有正文\n第二行"), null);
});

test("findFirstHeading 处理 CRLF 换行", () => {
    assert.equal(findFirstHeading("正文\r\n# 标题\r\n"), "标题");
});

test("pickExportBaseName 优先用文档名", () => {
    assert.equal(
        pickExportBaseName({
            documentName: "季度报告.md",
            frontMatterTitle: "front matter 标题",
            markdown: "# 正文标题",
        }),
        "季度报告",
    );
});

test("pickExportBaseName 无文档名时用 front matter 标题", () => {
    assert.equal(
        pickExportBaseName({ documentName: null, frontMatterTitle: "我的文章", markdown: "# 正文标题" }),
        "我的文章",
    );
});

test("pickExportBaseName 无文档名与 front matter 时用正文首个标题", () => {
    assert.equal(pickExportBaseName({ documentName: null, markdown: "# 正文标题\n内容" }), "正文标题");
});

test("pickExportBaseName 三者都没有时用默认名", () => {
    assert.equal(pickExportBaseName({ documentName: null }), DEFAULT_EXPORT_BASE_NAME);
    assert.equal(pickExportBaseName({ documentName: null, markdown: "没有标题的正文" }), DEFAULT_EXPORT_BASE_NAME);
});

test("pickExportBaseName 文档名清理后为空则继续往下退", () => {
    // 文档名整个都是非法字符，应退到标题
    assert.equal(pickExportBaseName({ documentName: '<>:"|?*.md', frontMatterTitle: "备用标题" }), "备用标题");
});

test("pickExportBaseName 保留设备名的文档名也会往下退", () => {
    assert.equal(pickExportBaseName({ documentName: "nul.md", frontMatterTitle: "备用标题" }), "备用标题");
});

test("pickExportBaseName 空白 front matter 标题不算有效", () => {
    assert.equal(
        pickExportBaseName({ documentName: null, frontMatterTitle: "   ", markdown: "# 正文标题" }),
        "正文标题",
    );
});

test("pickExportBaseName 标题里的非法字符被清掉", () => {
    assert.equal(pickExportBaseName({ documentName: null, frontMatterTitle: "进度: 50%/100%" }), "进度 50%100%");
});
