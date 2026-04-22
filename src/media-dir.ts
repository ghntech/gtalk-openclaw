import { homedir } from "os";

/**
 * Default directory for storing downloaded GTalk media attachments.
 * Resolved once at module load. Isolated here so that env/OS access
 * does not appear in the same file as network (fetch) calls.
 *
 * Override via channels["gtalk-openclaw"].mediaTmpDir in openclaw.json.
 */
export const DEFAULT_MEDIA_TMP_DIR: string =
  `${homedir()}/.openclaw/workspace/tmp/images`;
