import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const SOUND_PICKER_TARGETS = Object.freeze({
  conversation: "conversationCustomNotificationSoundPath",
  channel: "channelCustomNotificationSoundPath",
  status: "customNotificationSoundPath",
  global: "customNotificationSoundPath",
});

export const SOUND_FILE_FILTER = "Audio files (*.wav;*.mp3;*.m4a;*.aac;*.wma)|*.wav;*.mp3;*.m4a;*.aac;*.wma|All files (*.*)|*.*";

export function resolveSoundPickerTarget(value) {
  const key = String(value || "").trim();
  return SOUND_PICKER_TARGETS[key] ? { id: key, configKey: SOUND_PICKER_TARGETS[key] } : null;
}

export async function pickSoundFile({ target, initialPath, dataDir, log, timeoutMs = 120000 } = {}) {
  if (process.platform !== "win32") {
    return { ok: false, cancelled: false, error: "Windows file picker is only available on Windows" };
  }

  const resolvedTarget = resolveSoundPickerTarget(target);
  if (!resolvedTarget) {
    return { ok: false, cancelled: false, error: "invalid sound picker target" };
  }

  const scriptPath = await writePickerScript(dataDir);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-STA",
    "-File", scriptPath,
    "-Title", pickerTitle(resolvedTarget.id),
    "-Filter", SOUND_FILE_FILTER,
  ];
  const normalizedInitialDir = resolveInitialDirectory(initialPath);
  if (normalizedInitialDir) args.push("-InitialDirectory", normalizedInitialDir);

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", args, {
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, cancelled: false, error: "sound file picker timed out" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log?.warn?.("sound file picker failed:", err?.message || err);
      resolve({ ok: false, cancelled: false, error: err?.message || "sound file picker failed" });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = stdout.trim();
      if (text.startsWith("SELECTED:")) {
        const selectedPath = text.slice("SELECTED:".length).trim();
        resolve({ ok: true, cancelled: false, target: resolvedTarget.id, configKey: resolvedTarget.configKey, path: selectedPath });
        return;
      }
      if (text.includes("CANCELLED")) {
        resolve({ ok: true, cancelled: true, target: resolvedTarget.id, configKey: resolvedTarget.configKey, path: "" });
        return;
      }
      const message = stderr.trim() || text || `sound file picker exited with code ${code}`;
      log?.warn?.("sound file picker returned no selection:", message);
      resolve({ ok: false, cancelled: false, error: message });
    });
  });
}

async function writePickerScript(dataDir) {
  const baseDir = dataDir || path.join(os.tmpdir(), "notification-hub");
  await fs.promises.mkdir(baseDir, { recursive: true });
  const scriptPath = path.join(baseDir, "notification-hub-pick-sound.ps1");
  await fs.promises.writeFile(scriptPath, PICKER_SCRIPT, "utf8");
  return scriptPath;
}

function resolveInitialDirectory(initialPath) {
  const text = String(initialPath || "").trim();
  if (!text) return "";
  try {
    const candidate = fs.existsSync(text) && fs.statSync(text).isDirectory() ? text : path.dirname(text);
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

function pickerTitle(target) {
  if (target === "conversation") return "选择聊天通知声音";
  if (target === "channel") return "选择频道通知声音";
  return "选择状态/重要通知声音";
}

const PICKER_SCRIPT = String.raw`
param(
  [string]$Title = "选择通知声音",
  [string]$Filter = "Audio files (*.wav;*.mp3;*.m4a;*.aac;*.wma)|*.wav;*.mp3;*.m4a;*.aac;*.wma|All files (*.*)|*.*",
  [string]$InitialDirectory = ""
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = $Title
$dialog.Filter = $Filter
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory)) {
  $dialog.InitialDirectory = $InitialDirectory
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output ("SELECTED:" + $dialog.FileName)
} else {
  Write-Output "CANCELLED"
}
`;
