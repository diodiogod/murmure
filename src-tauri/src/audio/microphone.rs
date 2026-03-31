use cpal::traits::{DeviceTrait, HostTrait};
use cpal::SampleFormat;
use log::{debug, info, warn};
use std::collections::{HashMap, HashSet};
use tauri::Manager;

use super::types::MicInfo;

/// Lists available microphones.
/// On Linux, uses PulseAudio/PipeWire via `pactl` for clean device names.
/// On other platforms, uses CPAL device enumeration with filtering.
pub fn get_mic_list() -> Vec<MicInfo> {
    #[cfg(target_os = "linux")]
    {
        if let Some(mics) = list_sources_pactl() {
            return mics;
        }
        debug!("pactl unavailable, falling back to CPAL enumeration");
    }

    get_mic_list_cpal()
}

/// Resolves a mic_id to a CPAL Device for recording.
/// On Linux with manual selection, temporarily routes the default source
/// so CPAL records from the requested microphone during the active capture.
pub fn resolve_device_for_recording(
    mic_id: &str,
) -> Result<(cpal::Device, Option<String>), anyhow::Error> {
    let host = cpal::default_host();

    #[cfg(target_os = "linux")]
    {
        // Verify the source still exists before trying to use it
        if !is_pulse_source_available(mic_id) {
            return Err(anyhow::anyhow!("Selected microphone is unavailable"));
        }

        let previous_source = get_pulse_default_source();
        if previous_source.as_deref() != Some(mic_id) {
            set_pulse_default_source(mic_id);
        }
        // Small delay to let PipeWire apply the routing change
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Verify PipeWire actually applied the change
        if let Some(current) = get_pulse_default_source() {
            if current != mic_id {
                warn!(
                    "PulseAudio source mismatch: expected {:?}, got {:?}",
                    mic_id, current
                );
                return Err(anyhow::anyhow!("Selected microphone is unavailable"));
            }
        }

        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No default input device available"))?;

        Ok((device, previous_source.filter(|source| source != mic_id)))
    }

    #[cfg(not(target_os = "linux"))]
    {
        return find_device_by_identifier(mic_id)
            .map(|device| (device, None))
            .ok_or_else(|| anyhow::anyhow!("Selected microphone is unavailable"));
    }
}

// ── PulseAudio/PipeWire enumeration (Linux) ──

#[cfg(target_os = "linux")]
fn list_sources_pactl() -> Option<Vec<MicInfo>> {
    let output = std::process::Command::new("pactl")
        .args(["-f", "json", "list", "sources"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = String::from_utf8(output.stdout).ok()?;
    let sources: Vec<serde_json::Value> = serde_json::from_str(&json_str).ok()?;

    let mut mics = Vec::new();
    let mut seen_labels = HashSet::new();

    for source in &sources {
        let props = match source.get("properties").and_then(|p| p.as_object()) {
            Some(p) => p,
            None => continue,
        };
        let device_class = props
            .get("device.class")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if device_class != "sound" {
            continue;
        }

        let name = source.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let description = props
            .get("device.description")
            .and_then(|v| v.as_str())
            .unwrap_or(name);

        if name.is_empty() {
            continue;
        }

        let label = description.to_string();
        if seen_labels.insert(label.clone()) {
            debug!("Mic accepted (pactl): {} (source: {})", label, name);
            mics.push(MicInfo {
                id: name.to_string(),
                label,
            });
        }
    }

    // Fall back to CPAL if no valid sources found
    if mics.is_empty() {
        return None;
    }

    Some(mics)
}

#[cfg(target_os = "linux")]
fn is_pulse_source_available(source_name: &str) -> bool {
    let output = match std::process::Command::new("pactl")
        .args(["-f", "json", "list", "sources", "short"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return true, // If pactl fails, don't block recording
    };

    let json_str = match String::from_utf8(output.stdout) {
        Ok(s) => s,
        Err(_) => return true,
    };

    let sources: Vec<serde_json::Value> = match serde_json::from_str(&json_str) {
        Ok(s) => s,
        Err(_) => return true,
    };

    sources
        .iter()
        .any(|s| s.get("name").and_then(|v| v.as_str()) == Some(source_name))
}

#[cfg(target_os = "linux")]
fn get_pulse_default_source() -> Option<String> {
    let output = std::process::Command::new("pactl")
        .args(["get-default-source"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn set_pulse_default_source(source_name: &str) {
    match std::process::Command::new("pactl")
        .args(["set-default-source", source_name])
        .output()
    {
        Ok(output) if output.status.success() => {
            debug!("Set PulseAudio default source: {}", source_name);
        }
        Ok(output) => {
            warn!(
                "Failed to set PulseAudio default source: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Err(e) => {
            warn!("pactl not available: {}", e);
        }
    }
}

pub fn restore_default_source_after_recording(previous_source: Option<String>) {
    #[cfg(target_os = "linux")]
    if let Some(source_name) = previous_source {
        set_pulse_default_source(&source_name);
        info!("Restored PulseAudio default source: {}", source_name);
    }
}

// ── CPAL-based enumeration (macOS/Windows fallback) ──

fn get_mic_list_cpal() -> Vec<MicInfo> {
    let host = cpal::default_host();
    let default_id = host.default_input_device().and_then(|d| get_device_id(&d));

    match host.input_devices() {
        Ok(devices) => {
            let mut mics = Vec::new();
            let mut seen_ids = HashSet::new();

            for device in devices {
                let name = get_device_name(&device);
                let driver = device
                    .description()
                    .ok()
                    .and_then(|d| d.driver().map(|s| s.to_string()));

                if !is_valid_input_device(&device) {
                    debug!(
                        "Mic filtered (invalid input): {:?} (driver: {:?})",
                        name, driver
                    );
                    continue;
                }
                if !is_relevant_device(&device) {
                    debug!(
                        "Mic filtered (not relevant): {:?} (driver: {:?})",
                        name, driver
                    );
                    continue;
                }

                let Some(id) = get_device_id(&device) else {
                    debug!(
                        "Mic filtered (missing id): {:?} (driver: {:?})",
                        name, driver
                    );
                    continue;
                };

                if !seen_ids.insert(id.clone()) {
                    continue;
                }

                let label = get_device_label(&device, &id);
                debug!(
                    "Mic accepted: label={} id={} (driver: {:?})",
                    label, id, driver
                );
                mics.push(MicInfo { id, label });
            }

            let mut label_counts: HashMap<String, usize> = HashMap::new();
            for mic in &mics {
                *label_counts.entry(mic.label.clone()).or_insert(0) += 1;
            }

            for mic in &mut mics {
                if label_counts.get(&mic.label).copied().unwrap_or(0) > 1 {
                    let suffix = short_id_suffix(&mic.id);
                    mic.label = format!("{} [{}]", mic.label, suffix);
                }
            }

            if let Some(default) = default_id {
                if let Some(pos) = mics.iter().position(|m| m.id == default) {
                    let mic = mics.remove(pos);
                    mics.insert(0, mic);
                }
            }

            mics
        }
        Err(_) => {
            if let Some(device) = host.default_input_device() {
                if is_valid_input_device(&device) {
                    if let Some(id) = get_device_id(&device) {
                        let label = get_device_label(&device, &id);
                        return vec![MicInfo { id, label }];
                    }
                }
            }
            Vec::new()
        }
    }
}

fn is_supported_sample_format(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::I16
            | SampleFormat::F32
            | SampleFormat::I32
            | SampleFormat::U16
            | SampleFormat::U8
    )
}

fn is_valid_input_device(device: &cpal::Device) -> bool {
    if let Ok(config) = device.default_input_config() {
        let channels = config.channels();
        let format = config.sample_format();
        return channels >= 1 && is_supported_sample_format(format);
    }

    let configs = match device.supported_input_configs() {
        Ok(c) => c,
        Err(_) => return false,
    };

    for config in configs {
        let channels = config.channels();
        let format = config.sample_format();

        let valid_channels = channels >= 1;
        let valid_format = is_supported_sample_format(format);

        if valid_channels && valid_format {
            return true;
        }
    }

    false
}

fn is_relevant_device(device: &cpal::Device) -> bool {
    use cpal::{DeviceType, InterfaceType};

    let desc = match device.description() {
        Ok(d) => d,
        Err(_) => return false,
    };

    let device_type = desc.device_type();
    let interface_type = desc.interface_type();

    // On platforms with metadata (macOS/Windows), filter by type
    if device_type != DeviceType::Unknown || interface_type != InterfaceType::Unknown {
        // Virtual input devices are valid microphones on Windows
        // (for example NVIDIA Broadcast / similar voice processing tools).
        if matches!(device_type, DeviceType::Tuner) {
            return false;
        }
        if matches!(
            interface_type,
            InterfaceType::Network
                | InterfaceType::Aggregate
                | InterfaceType::Hdmi
                | InterfaceType::DisplayPort
                | InterfaceType::Spdif
        ) {
            return false;
        }
        return true;
    }

    // ALSA fallback: filter by PCM ID
    if let Some(driver) = desc.driver() {
        return driver.starts_with("sysdefault:");
    }

    true
}

fn get_device_name(device: &cpal::Device) -> Option<String> {
    if let Ok(desc) = device.description() {
        return Some(desc.name().to_string());
    }

    None
}

fn get_device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn normalize_label_part(value: &str) -> String {
    value.trim().to_lowercase()
}

fn is_generic_mic_name(value: &str) -> bool {
    let normalized = normalize_label_part(value);
    normalized == "microphone"
        || normalized == "microfone"
        || normalized == "microphone array"
        || normalized == "line in"
        || normalized == "default"
}

fn looks_technical(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.contains('{') && trimmed.contains('}') {
        return true;
    }

    let alnum_count = trimmed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .count();
    let hexish_count = trimmed
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == '-')
        .count();
    alnum_count > 0 && hexish_count * 2 >= alnum_count
}

fn short_id_suffix(id: &str) -> String {
    let mut chars: Vec<char> = id.chars().rev().take(8).collect();
    chars.reverse();
    chars.into_iter().collect()
}

fn get_device_label(device: &cpal::Device, fallback_id: &str) -> String {
    if let Ok(desc) = device.description() {
        let name = desc.name().trim();
        let name_value = if name.is_empty() {
            fallback_id.to_string()
        } else {
            name.to_string()
        };

        let name_normalized = normalize_label_part(&name_value);
        let mut best_extra: Option<&str> = None;
        let mut best_score: i32 = i32::MIN;
        for extra in desc.extended() {
            let extra = extra.trim();
            if extra.is_empty() {
                continue;
            }

            let extra_normalized = normalize_label_part(extra);
            if extra_normalized == name_normalized {
                continue;
            }

            let mut score = 0;
            if !looks_technical(extra) {
                score += 3;
            }
            if extra_normalized.contains(&name_normalized)
                || name_normalized.contains(&extra_normalized)
            {
                score += 2;
            }
            if (4..=96).contains(&extra.len()) {
                score += 1;
            }
            if score > best_score {
                best_score = score;
                best_extra = Some(extra);
            }
        }

        if let Some(extra) = best_extra {
            let extra_normalized = normalize_label_part(extra);
            if is_generic_mic_name(&name_value)
                || extra_normalized.contains(&name_normalized)
                || name_normalized.contains(&extra_normalized)
            {
                return extra.to_string();
            }
            return format!("{} ({})", name_value, extra);
        }

        let mut metadata_parts: Vec<String> = Vec::new();
        if let Some(manufacturer) = desc.manufacturer() {
            let manufacturer = manufacturer.trim();
            if !manufacturer.is_empty() && normalize_label_part(manufacturer) != name_normalized {
                metadata_parts.push(manufacturer.to_string());
            }
        }
        if let Some(driver) = desc.driver() {
            let driver = driver.trim();
            if !driver.is_empty() && normalize_label_part(driver) != name_normalized {
                metadata_parts.push(driver.to_string());
            }
        }
        if let Some(address) = desc.address() {
            let address = address.trim();
            if !address.is_empty() && normalize_label_part(address) != name_normalized {
                metadata_parts.push(address.to_string());
            }
        }

        metadata_parts.sort();
        metadata_parts.dedup();
        if !metadata_parts.is_empty() {
            return format!("{} ({})", name_value, metadata_parts.join(" | "));
        }

        return name_value;
    }

    fallback_id.to_string()
}

fn resolve_device_from_identifier(host: &cpal::Host, identifier: &str) -> Option<cpal::Device> {
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if get_device_id(&device).as_deref() == Some(identifier)
                || get_device_name(&device).as_deref() == Some(identifier)
            {
                return Some(device);
            }
        }
    }

    None
}

#[cfg(not(target_os = "linux"))]
fn find_device_by_identifier(identifier: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    resolve_device_from_identifier(&host, identifier)
}

pub fn update_mic_cache(app: &tauri::AppHandle, mic_id: Option<String>) {
    let audio_state = app.state::<crate::audio::types::AudioState>();
    match mic_id {
        Some(ref id) => {
            #[cfg(not(target_os = "linux"))]
            {
                audio_state.set_cached_device(find_device_by_identifier(id));
            }

            #[cfg(target_os = "linux")]
            {
                audio_state.set_cached_device(None);
            }

            info!("Microphone selection updated: {}", id);
        }
        None => {
            audio_state.set_cached_device(None);
        }
    }
}

pub fn init_mic_cache_if_needed(app: &tauri::AppHandle, mic_id: Option<String>) {
    if let Some(id) = mic_id {
        #[cfg(not(target_os = "linux"))]
        {
            let app_handle = app.clone();
            std::thread::spawn(move || {
                if let Some(device) = find_device_by_identifier(&id) {
                    let device_name = get_device_name(&device);
                    let audio_state = app_handle.state::<crate::audio::types::AudioState>();
                    audio_state.set_cached_device(Some(device));
                    if let Some(name) = device_name {
                        info!("Microphone cache initialized: {}", name);
                    }
                }
            });
        }

        #[cfg(target_os = "linux")]
        {
            let _ = app;
            info!("Microphone configured: {}", id);
        }
    }
}
