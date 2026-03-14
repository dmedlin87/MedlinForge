fn main() {
    println!("cargo:rerun-if-env-changed=BRONZEFORGE_UPDATE_MANIFEST_BASE_URL");
    println!("cargo:rerun-if-env-changed=BRONZEFORGE_UPDATE_PUBLISHER");

    let manifest_base_url = std::env::var("BRONZEFORGE_UPDATE_MANIFEST_BASE_URL")
        .unwrap_or_else(|_| "https://dmedlin87.github.io/MedlinForge/manifest".to_string());
    let publisher = std::env::var("BRONZEFORGE_UPDATE_PUBLISHER")
        .unwrap_or_else(|_| "dmedlin87".to_string());

    println!(
        "cargo:rustc-env=BRONZEFORGE_UPDATE_MANIFEST_BASE_URL={manifest_base_url}"
    );
    println!("cargo:rustc-env=BRONZEFORGE_UPDATE_PUBLISHER={publisher}");
    tauri_build::build()
}
