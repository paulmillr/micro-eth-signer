export function addHint(abi, name, fn) {
    const res = [];
    for (const elm of abi) {
        if (elm.type === 'event' && elm.name === name)
            res.push({ ...elm, hint: fn });
        else
            res.push(elm);
    }
    return res;
}
export function addHints(abi, map) {
    const res = [];
    for (const elm of abi) {
        // ABI event names can be `toString`; only explicit hint-map entries affect output.
        if (elm.type === 'event' && elm.name && Object.hasOwn(map, elm.name)) {
            res.push({ ...elm, hint: map[elm.name] });
        }
        else
            res.push(elm);
    }
    return res;
}
export function addHook(abi, name, fn) {
    const res = [];
    for (const elm of abi) {
        if (elm.type === 'function' && elm.name === name)
            res.push({ ...elm, hook: fn });
        else
            res.push(elm);
    }
    return res;
}
//# sourceMappingURL=abi-common.js.map