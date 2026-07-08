import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { FluxDispatcher } from "@vendetta/metro/common";

import { isEnabled } from "..";

const ChannelStore = findByProps("getChannel", "getDMFromUserId");
const ChannelMessages = findByProps("_channelMessages");
const MessageStore = findByProps("getMessage", "getMessages");

const EDIT_PREFIX = "`[ EDITED ]`\n\n";

const plain = value => {
    if (value == null) return value;

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
};

const cleanRef = ref => {
    if (!ref) return null;

    return Object.fromEntries(Object.entries({
        guild_id: ref.guild_id ?? ref.guildId,
        channel_id: ref.channel_id ?? ref.channelId,
        message_id: ref.message_id ?? ref.messageId,
        type: ref.type
    }).filter(([, value]) => value != null));
};

const cleanMessage = (source, extra = {}) => {
    const channelId = extra.channel_id ?? source?.channel_id ?? source?.channelId;
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;

    return Object.fromEntries(Object.entries({
        id: extra.id ?? source?.id,
        channel_id: channelId,
        guild_id: extra.guild_id ?? source?.guild_id ?? channel?.guild_id ?? null,
        content: String(extra.content ?? source?.content ?? ""),
        attachments: plain(extra.attachments ?? source?.attachments) ?? [],
        embeds: plain(extra.embeds ?? source?.embeds) ?? [],
        flags: extra.flags ?? source?.flags ?? 0,
        edited_timestamp: extra.edited_timestamp,
        message_reference: cleanRef(extra.message_reference ?? source?.message_reference ?? source?.messageReference)
    }).filter(([, value]) => value !== undefined));
};

export default deletedMessageArray => before("dispatch", FluxDispatcher, args => {
    if (!isEnabled) return;

    try {
        const ev = args[0];
        if (!ev || !ev.type) return;

        /* =========================================================
            MESSAGE_DELETE
        ==========================================================*/
        if (ev.type === "MESSAGE_DELETE") {
            if (ev.otherPluginBypass) return;

            const chId = ev.channelId ?? ev.channel_id;
            const orig = ChannelMessages.get(chId)?.get(ev.id) || MessageStore.getMessage(chId, ev.id);
            if (!orig?.author?.id || !orig.author.username) return;

            // ephemeral message dismiss / bots
            if ((orig?.author?.bot && orig?.flags === 64) || orig.author.bot) return;

            // empty message check
            if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;

            const entry = deletedMessageArray.get(ev.id);
            if (entry?.stage === 2) {
                if (deletedMessageArray.size >= 100) deletedMessageArray.clear();
                return; // kill message normally
            }

            if (entry?.stage === 1) {
                entry.stage = 2;
                return entry.message || args;
            }

            ev.type = "MESSAGE_UPDATE";
            ev.channelId = orig.channel_id || chId;
            ev.message = cleanMessage(orig, {
                channel_id: orig.channel_id || chId,
                content: orig.content,
                flags: 64
            });
            ev.optimistic = false;
            ev.sendMessageOptions = {};
            ev.isPushNotification = false;

            deletedMessageArray.set(ev.id, { message: args, stage: 1 });

            return args;
        }

        /* =========================================================
            MESSAGE_UPDATE
        ==========================================================*/
        if (ev.type === "MESSAGE_UPDATE") {
            if (ev.otherPluginBypass) return;

            const msg = ev.message;
            if (!msg || msg.author?.bot) return;

            const chId = msg.channel_id || ev.channelId;
            const id = msg.id || ev.id;

            const orig = MessageStore.getMessage(chId, id) || ChannelMessages.get(chId)?.get(id);
            if (!orig?.author?.id || !orig.author.username) return;

            if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;
            if (!msg.content || msg.content === orig.content) return;

            ev.message = cleanMessage(msg, {
                id,
                channel_id: chId,
                content: `${orig.content} ${EDIT_PREFIX}${msg.content}`,
                edited_timestamp: msg.edited_timestamp || new Date().toISOString(),
                message_reference: msg.message_reference ?? orig.message_reference ?? orig.messageReference
            });

            return args;
        }
    } catch (e) {
        showToast("[ANTIED Zero] FluxDispatcher crash – check logs");
        console.error("[ANTIED Zero] Flux patch\n", e);
    }
});
