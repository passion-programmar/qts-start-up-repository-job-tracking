"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPackaged = isPackaged;
exports.getAppRoot = getAppRoot;
exports.getLogoPath = getLogoPath;
exports.getBidderLogoPath = getBidderLogoPath;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
function isPackaged() {
    return 'pkg' in process;
}
function getAppRoot() {
    if (isPackaged()) {
        return node_path_1.default.dirname(process.execPath);
    }
    return process.cwd();
}
function getAssetPath(filename) {
    const candidates = [
        node_path_1.default.join(__dirname, '..', '..', 'src', filename),
        node_path_1.default.join(getAppRoot(), 'src', filename),
        node_path_1.default.join(getAppRoot(), filename),
    ];
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate)) {
            return node_path_1.default.resolve(candidate);
        }
    }
    return null;
}
function getLogoPath() {
    return getAssetPath('logo.png');
}
function getBidderLogoPath() {
    return getAssetPath('bidder-logo.png');
}
//# sourceMappingURL=paths.js.map