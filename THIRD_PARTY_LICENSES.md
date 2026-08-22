# Lokale Game-KI — Lizenzen der verwendeten Drittkomponenten

RLCS Legends nutzt für die lokale, offline laufende Game-KI zwei extern bezogene Komponenten. Beide werden zur Laufzeit auf den Rechner des Nutzers heruntergeladen (nicht im Git-Repository enthalten, siehe `.gitignore`), nicht ins Spiel einkompiliert.

## 1. llama.cpp (Inferenz-Runtime)

- **Projekt:** [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
- **Verwendete Version:** Release `b10411`, zwei Build-Varianten (Runde V5: automatische Wahl je nach Hardware):
  - Windows-CPU-x64-Build (`llama-b10411-bin-win-cpu-x64.zip`) -- Pflicht-Baseline, immer installiert
  - Windows-Vulkan-x64-Build (`llama-b10411-bin-win-vulkan-x64.zip`) -- optional, nur bei geeigneter GPU (≥4 GB VRAM) automatisch nachgeladen
- **Lizenz:** MIT License (identisch für beide Build-Varianten -- derselbe Quellcode/dieselbe Release, nur ein anderes Kompilat)
- **Kommerzielle Nutzung:** erlaubt
- **Redistribution:** erlaubt (MIT verlangt lediglich den Erhalt des Urheberrechts-/Lizenzhinweises)
- **Bezugsquelle:** offizielles GitHub-Release, auf den o.g. Tag gepinnt (kein "latest")
- **Laufzeit-Abhängigkeiten (Vulkan-Build):** ausschließlich der ohnehin auf dem Endnutzer-PC vorhandene GPU-Treiber (stellt den Vulkan-Loader/ICD bereit) -- kein separates Vulkan-SDK, kein CUDA-Toolkit, kein ROCm nötig. Geprüft: der Vulkan-Build enthält KEINE eigene `vulkan-1.dll`, nur die MIT-lizenzierte `ggml-vulkan.dll` von llama.cpp selbst.
- **Geprüfte, NICHT übernommene Alternative:** ROCm(HIP)-Build derselben Release (`llama-b10411-bin-win-rocm-7.14-x64.zip`) wurde probeweise heruntergeladen und geprüft -- ebenfalls MIT-lizenziert, aber technisch für eine Auto-Download-Distribution unpraktikabel: die enthaltene `ggml-hip.dll` ist allein 924 MB groß (statisch gelinkter HIP/rocBLAS-Runtime-Klumpen), fast 4x die Modellgröße nur für die Runtime. Nicht in `AI_RUNTIME_VARIANTS` aufgenommen.

> Die vollständige MIT-Lizenz von llama.cpp liegt im Projekt-Repository unter https://github.com/ggml-org/llama.cpp/blob/master/LICENSE und wird mit jedem Release-Build der Runtime mitgeliefert.

## 2. Qwen3-4B-Instruct-2507 (Sprachmodell, GGUF Q4_K_M)

- **Basismodell:** [Qwen/Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) (Alibaba/Qwen Team)
- **GGUF-Quantisierung:** [unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF), Datei `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`
- **Lizenz:** Apache License 2.0
- **Kommerzielle Nutzung:** erlaubt
- **Redistribution:** erlaubt (Apache-2.0 verlangt Erhalt des Lizenztexts + NOTICE bei Weitergabe von unverändertem/abgeleitetem Material)
- **Bezugsquelle:** Hugging Face, auf einen konkreten Commit gepinnt (nicht `resolve/main/...`), Integrität zusätzlich per SHA-256 geprüft (siehe `main.js`, `AI_MODEL_SHA256`)

> Die vollständige Apache-2.0-Lizenz liegt bei https://www.apache.org/licenses/LICENSE-2.0. Qwen3 selbst verändert/modifiziert das Basismodell nicht in einer Weise, die einer NOTICE-Pflicht unterläge, über die reine Quantisierung hinaus.

## Zusammenfassung für den Abschlussbericht

| Komponente | Lizenz | Kommerziell | Redistribution |
|---|---|---|---|
| llama.cpp b10411 (CPU-Build) | MIT | Ja | Ja |
| llama.cpp b10411 (Vulkan-Build) | MIT | Ja | Ja |
| Qwen3-4B-Instruct-2507 (Q4_K_M GGUF) | Apache-2.0 | Ja | Ja |

Keine der Lizenzen verbietet die hier gewählte Verwendung (lokale Inferenz innerhalb eines kommerziellen Spiels, Distribution der Binärdateien an Endnutzer über einen eigenen Auto-Download statt Bündelung im Installer). Diese Datei dokumentiert den Stand zum Zeitpunkt der Integration (2026-08-13, Vulkan-Ergänzung 2026-08-15) und sollte bei einem künftigen Versions-/Modellwechsel aktualisiert werden.
