import { before, after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { findByProps } from "@vendetta/metro";
import { regexEscaper, isEnabled } from "..";

const ActionSheet = findByProps("openLazy", "hideActionSheet");
const MessageStore = findByProps("getMessage", "getMessages");
const ChannelStore = findByProps("getChannel", "getDMFromUserId");
const ChannelMessages = findByProps("_channelMessages");
const { ActionSheetRow } = findByProps("ActionSheetRow");

const cleanRef = ref => {
    if (!ref) return null;

    return Object.fromEntries(Object.entries({
        guild_id: ref.guild_id ?? ref.guildId,
        channel_id: ref.channel_id ?? ref.channelId,
        message_id: ref.message_id ?? ref.messageId,
        type: ref.type
    }).filter(([, value]) => value != null));
};

function someFunc(a) {
    return a?.props?.label?.toLowerCase?.() === "reply";
}

export default () => before("openLazy", ActionSheet, ([component, args, actionMessage]) => {
    if (!isEnabled) return;

    try {
        const message = actionMessage?.message;

        if (args !== "MessageLongPressActionSheet" || !message) return;

        component.then(instance => {
            const unpatch = after("default", instance, (_, comp) => {
                try {
                    React.useEffect(() => () => { unpatch(); }, []);

                    const buttons = findInReactTree(comp, c => c?.find?.(someFunc));
                    if (!buttons) return comp;

                    const position = Math.max(
                        buttons.findIndex(someFunc),
                        buttons.length - 1
                    );

                    let originalMessage = null;

                    if (message?.channel_id && message?.id) {
                        originalMessage = MessageStore.getMessage(message.channel_id, message.id);

                        if (!originalMessage) {
                            const channel = ChannelMessages.get(message.channel_id);
                            originalMessage = channel?.get(message.id);
                        }
                    }

                    if (!originalMessage) return comp;

                    const escapedBuffer = regexEscaper("`[ EDITED ]`\n\n");
                    const separator = new RegExp(escapedBuffer, "gmi");
                    const checkIfBufferExist = separator.test(message.content);

                    if (checkIfBufferExist) {
                        const targetPos = position || 1;

                        buttons.splice(targetPos, 0, (
                            <ActionSheetRow
                                label="Remove Edit History"
                                subLabel="Added by Antied Zero"
                                icon={<ActionSheetRow.Icon source={getAssetIDByName("ic_edit_24px")} />}
                                onPress={() => {
                                    const lats = message.content.split(separator);
                                    const targetMessage = lats[lats.length - 1];

                                    const channelId = originalMessage.channel_id || message.channel_id;
                                    const channel = ChannelStore.getChannel(channelId);

                                    FluxDispatcher.dispatch({
                                        type: "MESSAGE_UPDATE",
                                        message: {
                                            id: message.id,
                                            channel_id: channelId,
                                            guild_id: channel?.guild_id ?? message.guild_id ?? null,
                                            content: String(targetMessage ?? ""),
                                            edited_timestamp: new Date().toISOString(),
                                            message_reference: cleanRef(message.message_reference ?? message.messageReference)
                                        },
                                        otherPluginBypass: true
                                    });

                                    ActionSheet.hideActionSheet();
                                    showToast("History Removed", getAssetIDByName("ic_edit_24px"));
                                }}
                            />
                        ));
                    }
                } catch (e) {
                    showToast("[ANTIED Zero] Crash on ActionSheet, check debug log for more info");
                    console.error("[ANTIED Zero] Error > ActionSheet:Component Patch\n", e);
                }
            });
        });
    } catch (e) {
        showToast("[ANTIED Zero] Crash on ActionSheet, check debug log for more info");
        console.error("[ANTIED Zero] Error > ActionSheet Patch\n", e);
    }
});
