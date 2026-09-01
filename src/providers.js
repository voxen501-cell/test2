async function openAiChat(url, cfg, system, messages, extraHeaders) {
  const build = (withEffort) => {
    const body = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    };
    if (withEffort && cfg.reasoningEffort) {
      body.reasoning_effort = cfg.reasoningEffort;
    }
    return JSON.stringify(body);
  };

  const post = (payload) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: payload,
    });

  let res = await post(build(true));
  let data = await readJson(res);

  if (!res.ok && /reasoning_effort/i.test(JSON.stringify(data))) {
    res = await post(build(false));
    data = await readJson(res);
  }
  if (!res.ok) throw new Error(errText(data, res.status));

  const choice = data.choices?.[0] || {};
  const msg = choice.message || {};
  const content = (msg.content || "").trim();
  if (content) return content;

  if (choice.finish_reason === "length") {
    throw new Error(
      "the model ran out of tokens before answering. Raise maxTokens in config.json."
    );
  }
  return "";
}

const PROVIDERS = {
  groq: {
    label: "Groq",
    defaultModel: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
    async chat(cfg, system, messages) {
      return openAiChat(
        "https://api.groq.com/openai/v1/chat/completions",
        cfg,
        system,
        messages,
        { authorization: "Bearer " + cfg.apiKey }
      );
    },
  },

  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    async chat(cfg, system, messages) {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(cfg.model) +
        ":generateContent";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { maxOutputTokens: cfg.maxTokens },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errText(data, res.status));
      return (
        data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? ""
      );
    },
  },

  openrouter: {
    label: "OpenRouter",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    keyUrl: "https://openrouter.ai/keys",
    async chat(cfg, system, messages) {
      return openAiChat(
        "https://openrouter.ai/api/v1/chat/completions",
        cfg,
        system,
        messages,
        { authorization: "Bearer " + cfg.apiKey }
      );
    },
  },

  ollama: {
    label: "Ollama (local, no key)",
    defaultModel: "llama3.2",
    keyUrl: "https://ollama.com/download",
    async chat(cfg, system, messages) {
      const host = cfg.ollamaHost || "http://127.0.0.1:11434";
      const res = await fetch(host + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          stream: false,
          messages: [{ role: "system", content: system }, ...messages],
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errText(data, res.status));
      return data.message?.content ?? "";
    },
  },

  claude: {
    label: "Claude (paid)",
    defaultModel: "claude-sonnet-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    async chat(cfg, system, messages) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          system,
          messages,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errText(data, res.status));
      return data.content?.map((b) => b.text || "").join("") ?? "";
    },
  },
};

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 400) };
  }
}

function errText(data, status) {
  const msg =
    data?.error?.message ||
    data?.error?.type ||
    data?.message ||
    data?._raw ||
    JSON.stringify(data).slice(0, 300);
  return "HTTP " + status + ": " + msg;
}

module.exports = { PROVIDERS };
