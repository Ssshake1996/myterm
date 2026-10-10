import { StateBase } from "./base.js";
import { withEnvironments } from "./environments.js";
import { withQuickCommands } from "./quick-commands.js";
import { withUpdates } from "./updates.js";
import { withSnapshots } from "./snapshots.js";
import { withConnections } from "./connections.js";
import { withLocalTerminal } from "./local-terminal.js";
import { withTerminalIo } from "./terminal-io.js";
import { withCommands } from "./commands.js";
import { withFiles } from "./files.js";

// RemoteOpsState is one object assembled from layers that each own one area. A layer is a mixin factory
// (Base) => class extends Base; the fields all layers share are created once by StateBase. No layer overrides
// another layer's method (test/state-layers.test.mjs checks that), so a method has exactly one home.
//   environments    Environment groups and environments: persistence, normalization, lookup and deletion.
//   quick-commands  Quick command groups and commands: persistence, ordering and the direct-dispatch button path.
//   updates         Checking GitHub Releases for a newer plugin version and installing it.
//   snapshots       What the UI and the model see: snapshots, the catalog, diagnostics events and tool receipts.
//   connections     SSH connections: spawning, opening, reconciling with the host, credentials, resize and disconnect records.
//   local-terminal  The shared local terminal that exists before any Agent does.
//   terminal-io     Reading and writing terminals: output frames, reads, input coordination, send, raw input and signals.
//   commands        Independent non-interactive commands that never touch the visible terminal.
//   files           Local and SFTP file access used by the file workspace and the sftp tools.
const layers = [withEnvironments, withQuickCommands, withUpdates, withSnapshots, withConnections, withLocalTerminal, withTerminalIo, withCommands, withFiles];

export class RemoteOpsState extends layers.reduce((Base, layer) => layer(Base), StateBase) {}
