# Native indent guides for Herdr 0.1.18

The File Editor package works with stock Herdr. Guide placement and soft wrapping are native drawing operations. The optional [renderer patch](herdr-0.1.18-indent-guides.patch) targets the [official v0.1.18 source](https://github.com/herdrdev/herdr-app/tree/v0.1.18).

The patch uses the shaped positions of tabs and spaces for each guide. A wrapped row carries the guides that fit in its hanging indent, including an indent made with tabs. The text buffer, Tab key and saved file use the same indentation settings as before.

To build, set `patch_file` to the absolute path of the downloaded patch. Use the Rust and Zig versions listed in the [upstream build instructions](https://github.com/herdrdev/herdr-app/blob/v0.1.18/README.md#build-from-source).

```sh
git clone --branch v0.1.18 --recurse-submodules https://github.com/herdrdev/herdr-app.git
cd herdr-app
git apply --check "$patch_file" && git apply "$patch_file"
cargo build --release --locked
```

The executable is `target/release/herdr-app`. To stage the comparison in a separate demo window, pass its absolute path as `HERDR_SHOTS_APP` when building the [screenshot sandbox](../screenshots/README.md) and run the `guides` step. An official app update installs that release’s renderer.
