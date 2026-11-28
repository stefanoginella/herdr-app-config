# External apps

File Explorer, Project Search, and Spaces Sidebar use the same app preferences. Their external actions open items on the computer running the Herdr window.

With no configuration file, the menus offer VS Code and Obsidian where available, plus TextEdit on macOS. On Linux and Windows, the VS Code preset uses `code` on Herdr’s PATH. On macOS, it can also find the app bundle. Obsidian opens folders and files in registered vaults. On macOS, it also offers to open `.md`, `.markdown`, `.canvas`, and `.base` files outside a vault. On Linux and Windows, the Obsidian preset uses the desktop’s registered `obsidian:` handler.

Files also have **Open with Default App**. **Reveal in Finder** on macOS and **Show in File Explorer** on Windows select the item. **Show in File Manager** on Linux asks the desktop to select it and falls back to opening its containing folder.

## Customize the menu

Create `external-apps.json` in your Herdr app folder, beside `keys.json`. The next menu you open reads it. Herdr caches app availability for up to 30 seconds. Keep this personal file outside the mod folders so package updates can replace those folders freely.

The `apps` array sets the named entries and their order. Use `"vscode"`, `"obsidian"`, or `"textedit"` for a preset. Leave a preset out to hide it. Use `{"apps": []}` to keep only the operating system’s default and reveal actions. This example puts the VS Code preset first and adds Zed. [Zed CLI reference](https://zed.dev/docs/reference/cli)

```json
{
  "apps": [
    "vscode",
    {
      "id": "zed",
      "label": "Zed",
      "targets": ["file", "folder"],
      "launch": {
        "macos": { "bundle": "dev.zed.Zed" },
        "linux": {
          "command": "zed",
          "args": ["{path}"],
          "at": ["{path}:{line}:{column}"]
        },
        "windows": {
          "command": "zed.exe",
          "args": ["{path}"],
          "at": ["{path}:{line}:{column}"]
        }
      }
    }
  ]
}
```

- `id` is unique and uses letters, numbers, underscores or hyphens. `default` and `reveal` are reserved. `label` appears after **Open in**. `targets` lists `file`, `folder`, or both. Optional `extensions` limits files by their endings, such as `[".md", ".markdown"]`.
- `launch` can have `macos`, `linux`, and `windows` entries. On macOS, `bundle` resolves an installed app by its bundle identifier. A `command` is an executable on Herdr’s PATH or an absolute executable path. Use `args` as a JSON array of individual arguments. On Windows, write a literal backslash as `\\` in JSON.
- `{path}` is the absolute file or folder path. `{repo}` is the repository folder for a file in a repository. A standalone `{repo}` argument is omitted when unavailable. `at` is an optional argument array used for a search match, with `{line}` and `{column}` starting at 1. A macOS bundle launch opens the file. To jump to a search match, configure the app’s command-line launcher and `at` arguments.

Unavailable launchers are skipped. An invalid settings file shows an error and uses the built-in presets.
