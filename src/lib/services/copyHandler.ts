import { getWenyanElement, writeHtmlToClipboard, writeTextToClipboard } from "$lib/utils";
import { globalState, gaojiangCopier, gaojiangRenderer } from "@gaojiang/ui";

export async function copyHandler() {
    if (globalState.getPlatform() === "juejin") {
        writeTextToClipboard(gaojiangRenderer.postHandlerContent);
    } else {
        const wenyanElement = getWenyanElement();
        await gaojiangCopier.copy(wenyanElement);
        writeHtmlToClipboard(gaojiangCopier.html);
    }
}
