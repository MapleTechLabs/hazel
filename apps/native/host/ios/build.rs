//! The simulator takes an app's entitlements from its executable (`__TEXT,__entitlements`), as
//! Xcode's simulator builds embed them: the keychain (the sign-in vault) serves only an app with
//! an identifier and an access group. An ad-hoc signature carries none.
use std::path::PathBuf;

/// The team prefix of an ad-hoc signed simulator build: any ten characters do.
const TEAM: &str = "HAZELSIM00";
const BUNDLE_ID: &str = "sh.hazel.ios";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.ends_with("-apple-ios-sim") {
        return;
    }
    let id = format!("{TEAM}.{BUNDLE_ID}");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>application-identifier</key>
	<string>{id}</string>
	<key>keychain-access-groups</key>
	<array>
		<string>{id}</string>
	</array>
</dict>
</plist>
"#
    );
    let path = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"))
        .join("entitlements.plist");
    std::fs::write(&path, plist).expect("write the entitlements");
    println!(
        "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__entitlements,{}",
        path.display()
    );
}
