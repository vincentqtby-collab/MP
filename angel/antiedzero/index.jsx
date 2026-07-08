import fluxDispatchPatch from "./patches/flux_dispatch";
import selfEditPatch from "./patches/self_edit";

import actionsheet from "./patches/actionsheet";
import SettingPage from "./Settings";
import { fetchDB, selfDelete } from "~lib/func/bl";

export const regexEscaper = string => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export let isEnabled = false;

const deletedMessageArray = new Map();
let unpatches = [];

// [Function, ArrayOfArguments]
const patches = [
    [fluxDispatchPatch, [deletedMessageArray]],
    [actionsheet, []],
    [selfEditPatch, []]
];

const patcher = () => patches
    .map(([fn, args]) => fn?.(...args))
    .filter(Boolean);

export default {
    onLoad: async () => {
        if (!unpatches.length) unpatches = patcher();
        isEnabled = true;

        try {
            const datas = await fetchDB(database);
            selfDelete(datas, 15); // 15 sec
        } catch (e) {
            console.warn("[ANTIED Zero] Failed to check blocklist", e);
        }
    },
    onUnload: () => {
        isEnabled = false;

        unpatches.forEach(unpatch => {
            try { unpatch?.(); } catch {}
        });
        unpatches = [];
    },
    settings: SettingPage
};

const database = "https://angelix1.github.io/static_list/antied/list.json";
