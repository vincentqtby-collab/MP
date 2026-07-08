import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { regexEscaper, isEnabled } from "..";

const Message = findByProps("sendMessage", "startEditMessage");

export default () => before("startEditMessage", Message, args => {
    if (!isEnabled) return;

    const [, , msg] = args;
    if (typeof msg !== "string") return;

    const DAN = regexEscaper("`[ EDITED ]`\n\n");
    const regexPattern = new RegExp(DAN, "gmi");

    const lats = msg.split(regexPattern);
    args[2] = lats[lats.length - 1];
});
