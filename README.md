# 玄鱼智创skills

`shop-video-skills` — a Hypit-based video production Skill for 玄鱼智创, wired to the team's own
image, video and speech services instead of a hosted default.

## 能力

| 能力 | Hypit Capability | 服务模型 | 已验证输出 |
| --- | --- | --- | --- |
| 生图 | `@hypit/gpt-image@1#gpt-image-2` | sub2api `gpt-image-2.5-sunburst` | 9:16 → 941×1672 |
| 生视频 | `@hypit/seedance@1#seedance-2-mini` | TF-router `Seedance 2.0 mini` | 5 s 480p → 496×864 |
| 生视频 | `@hypit/minimax-h3@1#minimax-h3` | TF-router `MiniMax-H3` | 4 s 768p → 768×1344 |
| 生音频 | `@hypit/fishaudio-speech@1#voice-clone` | TF-router `seed-audio-1.0` | 7 词 → 5.7 s MP3 |

参考图通过 sub2api 的 `/images/edits` multipart 接口传递；实测单个和多个参考对象都能原样保留。

## 目录

```
SKILL.md                           Skill 入口与路由表
agents/openai.yaml                 显示名与默认提示
references/
├── creation/                      目标、参考理解、改写、Script
├── environment/                   安装、Profile、凭据、自建 Provider
├── playbooks/                     格式与 craft（导演知识）
└── production/                    SVML/SVS/SVRun、Timeline、组件、构建
assets/provider-packages/          两个可编译的 Provider 包与 runtime 示例
```

## 安装

把整个目录放到你的 Agent skills 目录，例如：

```bash
git clone https://github.com/fsbazi/shop-video-skills.git ~/.zcode/skills/shop-video-skills
```

调用：`$shop-video-skills`。

还需要安装 Hypit 可执行文件：

```bash
npm install -g @hypit/hypit
hypit version
```

## 接入自己的服务

1. 按 [references/environment/project-providers.md](references/environment/project-providers.md)
   把 `assets/provider-packages/` 下的两个包复制进视频项目并编译安装。
2. 合并 `assets/provider-packages/hypit.runtime.example.json` 中的 endpoints 与 bindings。
3. 用 `hypit auth login <endpoint> --from <private-key-file>` 把 key 写入 Credential Store。

需要音频时，先向用户索取一段干净的参考音色（或使用已有 A-roll 片段）；本 Skill 不提供
默认音色的纯 TTS 请求。

## 已验证的限制

- 生图只接受 `1K`；`2K`/`4K` 在 `supports` 阶段拒绝，服务输出约 1.5 MP。
- 宽高比通过提示词尾缀控制；`size` 参数对该服务不生效。
- Seedance 2.0 mini：480p/720p，4–15 秒；MiniMax-H3：768p，4–15 秒，无视频参考、无 2K、无 Web Search。
- 视频请求必须带 `metadata.references`，即使为空数组。
- 音频仅支持 `voice-clone`；`VoiceDesign` 未绑定。

## 许可与署名

本仓库是 Hypit Skill 的派生作品：

- 原始作品：© 2026 Hypit.AI，采用修改版 Apache License 2.0（见 [LICENSE](LICENSE)）。
- 修改部分：© 2026 玄鱼智创，Provider 包与文档按自有服务栈适配。
- 本仓库不用于商业转售；派生作品沿用同一许可证。

Hypit 名称、LOGO 与版权信息保留在相关文档中。

## 安全

不要把 API key 写入 Source、Run、Profile、README 或提交历史。凭据只通过
`hypit auth login` 进入 Credential Store。
