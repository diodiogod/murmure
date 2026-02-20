use cpal::traits::{DeviceTrait, HostTrait};
use cpal::SampleFormat;
use log::info;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicDevice {
    pub id: String,
    pub label: String,
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

    let alnum_count = trimmed.chars().filter(|c| c.is_ascii_alphanumeric()).count();
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

fn get_device_name(device: &cpal::Device) -> Option<String> {
    if let Ok(desc) = device.description() {
        return Some(desc.name().to_string());
    }

    None
}

fn get_device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
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
            if !manufacturer.is_empty()
                && normalize_label_part(manufacturer) != name_normalized
            {
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

pub fn resolve_input_device(identifier: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    resolve_device_from_identifier(&host, identifier)
}

pub fn get_mic_list() -> Vec<MicDevice> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| get_device_id(&d));

    match host.input_devices() {
        Ok(devices) => {
            let mut mic_devices: Vec<MicDevice> = Vec::new();
            let mut seen_ids = HashSet::new();

            for device in devices {
                if !is_valid_input_device(&device) {
                    continue;
                }

                let Some(id) = get_device_id(&device) else {
                    continue;
                };

                if !seen_ids.insert(id.clone()) {
                    continue;
                }

                let label = get_device_label(&device, &id);
                mic_devices.push(MicDevice { id, label });
            }

            let mut label_counts: HashMap<String, usize> = HashMap::new();
            for mic in &mic_devices {
                *label_counts.entry(mic.label.clone()).or_insert(0) += 1;
            }
            for mic in &mut mic_devices {
                if label_counts.get(&mic.label).copied().unwrap_or(0) > 1 {
                    let suffix = short_id_suffix(&mic.id);
                    mic.label = format!("{} [{}]", mic.label, suffix);
                }
            }

            if let Some(default) = default_id {
                if let Some(pos) = mic_devices.iter().position(|m| m.id == default) {
                    let default_mic = mic_devices.remove(pos);
                    mic_devices.insert(0, default_mic);
                }
            }

            mic_devices
        }
        Err(_) => {
            if let Some(device) = host.default_input_device() {
                if is_valid_input_device(&device) {
                    if let Some(id) = get_device_id(&device) {
                        let label = get_device_label(&device, &id);
                        return vec![MicDevice { id, label }];
                    }
                }
            }
            Vec::new()
        }
    }
}

pub fn update_mic_cache(app: &tauri::AppHandle, mic_id: Option<String>) {
    let audio_state = app.state::<crate::audio::types::AudioState>();
    match mic_id {
        Some(ref id) => {
            let host = cpal::default_host();
            let found_device = resolve_device_from_identifier(&host, id);
            audio_state.set_cached_device(found_device);
        }
        None => {
            audio_state.set_cached_device(None);
        }
    }
}

pub fn init_mic_cache_if_needed(app: &tauri::AppHandle, mic_id: Option<String>) {
    if let Some(id) = mic_id {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let host = cpal::default_host();
            if let Some(device) = resolve_device_from_identifier(&host, &id) {
                if let Some(name) = get_device_name(&device) {
                    info!("Microphone cache initialized: {}", name);
                }
                let audio_state = app_handle.state::<crate::audio::types::AudioState>();
                audio_state.set_cached_device(Some(device));
            }
        });
    }
}
