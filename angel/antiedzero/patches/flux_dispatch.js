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

const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const safeDiscriminator = user => {
    // Discord's Android renderer may parse this as Integer.
    // Never let placeholders like "???" reach getDefaultAvatarURL().
    const value = user?.discriminator ?? user?.discrim ?? 0;
    const str = String(value);
    return /^\d+$/.test(str) ? str : "0";
};

const cleanUser = user => {
    if (!user?.id) return undefined;

    const username = String(
        user.username ??
        user.global_name ??
        user.globalName ??
        user.display_name ??
        user.displayName ??
        "Unknown User"
    );

    const globalName = user.global_name ?? user.globalName ?? null;
    const displayName = user.display_name ?? user.displayName ?? globalName ?? username;
    const avatar = typeof user.avatar === "string" ? user.avatar : null;
    const avatarDecoration = plain(user.avatar_decoration_data ?? user.avatarDecorationData) ?? null;
    const publicFlags = user.public_flags ?? user.publicFlags ?? 0;

    return Object.fromEntries(Object.entries({
        id: String(user.id),
        username,
        global_name: globalName,
        display_name: displayName,
        discriminator: safeDiscriminator(user),
        avatar,
        avatar_decoration_data: avatarDecoration,
        public_flags: num(publicFlags, 0),
        bot: !!user.bot
    }).filter(([, value]) => value !== undefined));
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
    const author = cleanUser(extra.author ?? source?.author);

    return Object.fromEntries(Object.entries({
        id: String(extra.id ?? source?.id ?? ""),
        channel_id: channelId,
        guild_id: extra.guild_id ?? source?.guild_id ?? channel?.guild_id ?? null,
        author,
        content: String(extra.content ?? source?.content ?? ""),
        attachments: plain(extra.attachments ?? source?.attachments) ?? [],
        embeds: plain(extra.embeds ?? source?.embeds) ?? [],
        flags: num(extra.flags ?? source?.flags, 0),
        edited_timestamp: extra.edited_timestamp,
        timestamp: extra.timestamp ?? source?.timestamp ?? new Date().toISOString(),
        message_reference: cleanRef(extra.message_reference ?? source?.message_reference ?? source?.messageReference)
    }).filter(([, value]) => value !== undefined && value !== ""));
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
                author: orig.author,
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
                author: orig.author ?? msg.author,
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
