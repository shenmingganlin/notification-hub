/**
 * agent-resolver.js
 *
 * 从 Agent 配置文件（config.yaml）中解析展示信息（名称、角色主题颜色）。
 * 使用手动 YAML 解析避免依赖兼容问题。
 */
import fs from "node:fs";
import path from "node:path";

// ─── 角色主题色板 ───
const THEME_PALETTE = {
  hanako: {
    primary: "#9b59b6",
    gradient: "linear-gradient(135deg, #667eea 0%, #9b59b6 100%)",
    accent: "#e74c3c",
    label: "Hanako",
    emoji: "🌸",
  },
  butter: {
    primary: "#e67e22",
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    accent: "#f39c12",
    label: "Butter",
    emoji: "🦋",
  },
  chatgpt: {
    primary: "#10a37f",
    gradient: "linear-gradient(135deg, #00b894 0%, #00cec9 100%)",
    accent: "#00b894",
    label: "ChatGPT",
    emoji: "💬",
  },
  ming: {
    primary: "#2d3436",
    gradient: "linear-gradient(135deg, #636e72 0%, #2d3436 100%)",
    accent: "#0984e3",
    label: "Ming",
    emoji: "🧊",
  },
  rational: {
    primary: "#2d3436",
    gradient: "linear-gradient(135deg, #636e72 0%, #2d3436 100%)",
    accent: "#0984e3",
    label: "Ming",
    emoji: "🧊",
  },
};

const DEFAULT_THEME = {
  primary: "#636e72",
  gradient: "linear-gradient(135deg, #636e72 0%, #2d3436 100%)",
  accent: "#0984e3",
  label: "Assistant",
  emoji: "🤖",
};

function cleanYamlScalar(value) {
  return String(value || "")
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

/**
 * 简易 YAML 解析：只提取 agent.name 和 agent.yuan
 */
function readAgentConfig(agentsDir, agentId) {
  const configPath = path.join(agentsDir, agentId, "config.yaml");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const lines = raw.split("\n");

    let displayName = agentId;
    let yuan = null;
    let inAgentBlock = false;
    let agentIndent = -1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = (line.match(/^[ \t]*/) || [""])[0].length;
      if (/^agent:\s*(?:#.*)?$/.test(trimmed)) {
        inAgentBlock = true;
        agentIndent = indent;
        continue;
      }
      if (inAgentBlock && indent <= agentIndent) {
        inAgentBlock = false;
      }
      if (!inAgentBlock) continue;

      const nameMatch = trimmed.match(/^name:\s*(.+)$/);
      if (nameMatch) {
        displayName = cleanYamlScalar(nameMatch[1]);
      }
      const yuanMatch = trimmed.match(/^yuan:\s*(.+)$/);
      if (yuanMatch) {
        yuan = cleanYamlScalar(yuanMatch[1]);
      }
    }

    return { displayName, yuan };
  } catch {
    return { displayName: agentId, yuan: null };
  }
}

/**
 * Agent 解析器
 */
export class AgentResolver {
  constructor(agentDir, log) {
    this._agentDir = agentDir;
    this._log = log;
    this._cache = new Map();
    this._initialized = false;
  }

  /**
   * 扫描 agents 目录，初始化缓存
   */
  init() {
    try {
      if (!fs.existsSync(this._agentDir)) {
        this._log.warn(`agents directory not found: ${this._agentDir}`);
        return;
      }
      const entries = fs.readdirSync(this._agentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentId = entry.name;
        const config = readAgentConfig(this._agentDir, agentId);
        const theme = THEME_PALETTE[agentId] || THEME_PALETTE[config.yuan] || DEFAULT_THEME;
        this._cache.set(agentId, {
          id: agentId,
          displayName: config.displayName,
          yuan: config.yuan || agentId,
          theme,
        });
      }
      this._initialized = true;
      this._log.info(`AgentResolver: initialized with ${this._cache.size} agents`);
    } catch (err) {
      this._log.error(`AgentResolver init failed: ${err.message}`);
    }
  }

  /**
   * 获取 agent 信息
   */
  get(agentId) {
    if (!agentId) return this._buildDefault("unknown");
    if (this._cache.has(agentId)) return this._cache.get(agentId);
    // 未缓存的 agent 动态加载
    const config = readAgentConfig(this._agentDir, agentId);
    const theme = THEME_PALETTE[agentId] || THEME_PALETTE[config.yuan] || DEFAULT_THEME;
    const info = { id: agentId, displayName: config.displayName, yuan: config.yuan || agentId, theme };
    this._cache.set(agentId, info);
    return info;
  }

  /**
   * 从 sender 标识推断 agent 信息
   */
  resolveFromSender(sender) {
    if (!sender) return this._buildDefault("system");
    if (this._cache.has(sender)) return this._cache.get(sender);
    return this._buildDefault(sender);
  }

  /**
   * 从 modelId 猜测 agent
   */
  resolveFromModel(modelId) {
    if (!modelId) return this._buildDefault("assistant");
    const lower = modelId.toLowerCase();
    if (lower.includes("flash") || lower.includes("hanako")) return this.get("hanako");
    if (lower.includes("pro") || lower.includes("ming") || lower.includes("rational")) return this.get("ming");
    if (lower.includes("gpt") || lower.includes("chatgpt")) return this.get("chatgpt");
    if (lower.includes("butter")) return this.get("butter");
    return this._buildDefault(modelId);
  }

  /**
   * 列出所有已知 agent
   */
  list() {
    return Array.from(this._cache.values());
  }

  _buildDefault(id) {
    return {
      id,
      displayName: id.charAt(0).toUpperCase() + id.slice(1),
      yuan: id,
      theme: DEFAULT_THEME,
    };
  }
}
