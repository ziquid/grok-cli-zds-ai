# Image Generation Guide

Complete documentation for the `generate_image_sd.sh` script and image generation tools.

## Overview

`generate_image_sd.sh` is a lightweight Zsh script that calls a **Stable Diffusion** API to generate images from text prompts.  It saves images as PNG files and can optionally move them to another folder for easy access.

## Prerequisites

### Required Dependencies

```sh
brew install jq curl coreutils
```

### External Services

- You must have access to a **Stable Diffusion API** service

## Installation

The script is included in the `src/` directory. After running `mzke install`, it will be available in your PATH.

## Basic Usage

```sh
generate_image_sd.sh "your prompt here" [options]
```

### Simple Examples

```sh
# Basic image generation
generate_image_sd.sh "sunset over mountains"

# With negative prompt
generate_image_sd.sh "beautiful landscape" "blurry, low quality"

# Move to external folder
generate_image_sd.sh "professional headshot" --move
```

## Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--move` | Move generated PNG to external folder | *off* |
| `--width <num>` | Image width in pixels | `480` |
| `--height <num>` | Image height in pixels | `720` |
| `--cfg-scale <value>` | Classifier-Free Guidance scale | `5.0` |
| `--steps <count>` | Number of diffusion steps | `30` |
| `--sampler <sampler>` | Sampler name | `DPM++ 2M Karras` |
| `--model <model>` | Model checkpoint (without extension) | `cyberrealisticPony_v130` |
| `--name <name>` | Base name for output file | Prompt text |
| `--list-models` | Show installed models | (N/A) |


## Advanced Usage

### High-Quality Settings

```sh
generate_image_sd.sh "beautiful woman, professional photo" \
  --width 1024 --height 1024 --cfg-scale 7.5 --steps 50 --move
```

### Landscape Photography

```sh
generate_image_sd.sh "tropical beach at sunset, palm trees, golden hour" \
  --width 1152 --height 648 --steps 40 --sampler "DPM++ 2M Karras"
```

### Custom Model Selection

```sh
generate_image_sd.sh "futuristic cityscape" \
  --model "cyberrealisticPony_v130" --cfg-scale 6.5
```

## Output Locations

### Default Output

- Images saved to: `out/photos/` directory from agent's home dir
- Naming format: `{slugified-prompt}.png`
- Log file: In agent's log dir

### ZAI Integration

When using `--move`:
- Images moved to: `$ZDS_AI_IMAGE_MOVE_DIR`
- Original PNG deleted from source location

## API Integration

The script communicates with the local Stable Diffusion API:

1. **Endpoint**: `$ZDS_AI_IMAGE_ENDPOINT`, e.g. `http://my.sd.server.net:7860/sdapi/v1`
2. **Method**: POST with JSON payload
3. **Response**: Base64 encoded image data
4. **Processing**: Converts base64 to PNG file

## Configuration

### Environment Variables

- `ZDS_AI_AGENT_CONFIG_FILE`: Agent config file
- `ZDS_AI_AGENT_LOGS_DIR`: Agent logs dir
- `ZDS_AI_AGENT_SESSION`: Agent session ID
- `ZDS_AI_AGENT_HOME_DIR`: Agent home dir
- `ZDS_AI_IMAGE_ENDPOINT`: SD API endpoint
- `ZDS_AI_IMAGE_MOVE_DIR`: External folder for images

## Error Handling

Common issues and solutions:

### API Connection Failed

```sh
# List installed models to test API connectivity
generate_image_sd.sh --list-models
```

### Memory Issues

- Reduce image dimensions (`--width`, `--height`)
- Decrease step count (`--steps`)
- Use a smaller model checkpoint

## Performance Optimization

### Faster Generation

- Use fewer steps (`--steps 20`)
- Smaller dimensions (`--width 512 --height 512`)
- Faster sampler (`--sampler "Euler a Automatic"`)

### Higher Quality

- Increase steps (`--steps 50+`)
- Higher CFG scale (`--cfg-scale 7.0+`)
- Use quality-focused samplers

## Integration Examples

### Batch Processing

```sh
# Generate multiple images
for prompt in sunset mountains ocean; do
  generate_image_sd.sh "$prompt landscape" --name "$prompt-scene"
done
```

### Pipeline Integration

```sh
# Generate then caption
generate_image_sd.sh "robot in city" --name "robot-city" --move
joycaption /path/to/robot-city.png
```

## Troubleshooting

### Debug Mode

Uncomment `set -x` in the script for verbose output.

### Log Analysis

Check logfile for:

- API request/response details
- Error messages
- Performance metrics

### Common Errors

- **"Failed to connect to SD server"**: API service not running
- **"Invalid model checkpoint"**: Wrong model name
- **"Out of memory"**: Reduce image size or steps
- **"Base64 decode failed"**: API response issue

## Security Notes

- Log files will contain prompt text, handle appropriately
