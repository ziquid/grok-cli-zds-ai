import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types/index.js";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery.js";

const execAsync = promisify(exec);

export class ImageTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }

  /**
   * Generate an image using AI image generation.
   * Uses generate_image_asl.sh script with Stable Diffusion.
   */
  async generateImage(
    prompt: string,
    negativePrompt?: string,
    width?: number,
    height?: number,
    model?: string,
    sampler?: string,
    configScale?: number,
    numSteps?: number,
    nsfw?: boolean,
    name?: string,
    move?: boolean
  ): Promise<ToolResult> {
    try {
      if (!prompt) {
        return {
          success: false,
          error: "Prompt is required",
          output: "Prompt is required"
        };
      }

      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Get the agent's home directory and create Images path
      const agentHome = process.env.ZDS_AI_AGENT_HOME_DIR;
      if (!agentHome) {
        return {
          success: false,
          error: "Agent home directory not found",
          output: "Agent home directory not found"
        };
      }

      const imagesDir = `${agentHome}/Images`;

      // Ensure Images directory exists
      try {
        await execAsync(`mkdir -p "${imagesDir}"`);
      } catch (error) {
        return {
          success: false,
          error: `Failed to create Images directory: ${error}`,
          output: `Failed to create Images directory: ${error}`
        };
      }

      // Set defaults
      const defaultNegativePrompt = "score_6, score_5, score_4, (worst quality:1.2), (low quality:1.2), (normal quality:1.2), lowres, bad anatomy, bad hands, signature, watermarks, ugly, imperfect eyes, skewed eyes, unnatural face, unnatural body, error, extra limb, missing limbs";
      const finalModel = model || "cyberrealisticPony_v130";
      const finalWidth = width || 480;
      const finalHeight = height || 720;
      const finalSampler = sampler || "DPM++ 2M Karras";
      const finalConfigScale = configScale || 5.0;
      const finalNumSteps = numSteps || 30;
      const finalNsfw = nsfw !== undefined ? nsfw : false;
      const finalMove = move !== undefined ? move : false;
      const finalNegativePrompt = negativePrompt || defaultNegativePrompt;

      // Handle NSFW flag: when nsfw=true, allow NSFW content (prepend to prompt)
      // when nsfw=false (default), avoid NSFW content (prepend to negative prompt)
      const finalPrompt = finalNsfw ? `NSFW, ${prompt}` : prompt;

      // If nsfw is on, strip out any "NSFW" from negative prompt (case-insensitive)
      let finalNegativePromptWithNsfw: string;
      if (finalNsfw) {
        // Remove all "NSFW" variants - keep replacing until none left
        finalNegativePromptWithNsfw = finalNegativePrompt;
        let prev = '';
        while (prev !== finalNegativePromptWithNsfw) {
          prev = finalNegativePromptWithNsfw;
          finalNegativePromptWithNsfw = finalNegativePromptWithNsfw
            .replace(/NSFW,?\s*/gi, '')  // Remove NSFW with optional comma and spaces
            .replace(/,\s*,/g, ',')  // Clean up double commas
            .replace(/^\s*,\s*/, '')  // Remove leading comma
            .trim();
        }
      } else {
        // nsfw is off, prepend "NSFW, " to block NSFW content
        finalNegativePromptWithNsfw = `NSFW, ${finalNegativePrompt}`;
      }

      // Escape prompts for shell
      const escapedPrompt = finalPrompt.replace(/'/g, "'\\''");
      const escapedNegativePrompt = finalNegativePromptWithNsfw.replace(/'/g, "'\\''");

      // Build command using generate_image_asl.sh
      let command = `generate_image_asl.sh '${escapedPrompt}' '${escapedNegativePrompt}'`;

      if (finalMove) {
        command += ' --move';
      }

      command += ` --width ${finalWidth} --height ${finalHeight} --cfg-scale ${finalConfigScale} --steps ${finalNumSteps} --sampler '${finalSampler}' --model '${finalModel}'`;

      if (name) {
        const escapedName = name.replace(/'/g, "'\\''");
        command += ` --name '${escapedName}'`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 300000 // 5 minute timeout
        });

        // Parse output to find the generated file path
        // The script should output the path to the generated image
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];

        // Look for a file path in the output
        let filepath = lastLine;
        if (!filepath.startsWith('/')) {
          // If no absolute path found, construct expected path
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
          const filename = name ? `${name}-${timestamp}.png` : `generated-${timestamp}.png`;
          filepath = `${imagesDir}/${filename}`;
        }

        // Get file size if file exists
        let fileSize = "unknown";
        try {
          const { stdout: sizeOutput } = await execAsync(`ls -lh "${filepath}" 2>/dev/null | awk '{print $5}'`);
          fileSize = sizeOutput.trim() || "unknown";
        } catch {
          fileSize = "unknown";
        }

        return {
          success: true,
          output: `Image generated successfully\nPrompt: ${prompt}\nModel: ${finalModel}\nSize: ${finalWidth}x${finalHeight}\nSteps: ${finalNumSteps}\nGuidance: ${finalConfigScale}\nPath: ${filepath}\nFile Size: ${fileSize}`,
          displayOutput: `Generated image (${finalWidth}x${finalHeight})`
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Image generation failed: ${error.message}`,
          output: `Image generation failed: ${error.message}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error generating image",
        output: error instanceof Error ? error.message : "Unknown error generating image"
      };
    }
  }

  /**
   * Caption an image using AI image captioning.
   * Uses joycaption script.
   */
  async captionImage(
    filename: string,
    prompt?: string
  ): Promise<ToolResult> {
    try {
      if (!filename) {
        return {
          success: false,
          error: "Filename is required",
          output: "Filename is required"
        };
      }

      // Build command using joycaption
      let command = `joycaption '${filename.replace(/'/g, "'\\''")}'`;

      if (prompt) {
        command += ` --prompt "${prompt.replace(/"/g, '\\"')}"`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 90000, // 90 second timeout
          shell: '/bin/zsh'
        });

        // If there's stderr output, include it but still return success if we got stdout
        if (stderr && !stdout) {
          return {
            success: false,
            error: `Image captioning failed: ${stderr}`,
            output: stderr
          };
        }

        const caption = stdout.trim();
        return {
          success: true,
          output: caption,
          displayOutput: `Caption: ${caption}`
        };
      } catch (error: any) {
        // Extract error details
        const errorMessage = error.message || "Unknown error";
        const stderr = error.stderr || "";
        const stdout = error.stdout || "";

        return {
          success: false,
          error: `Image captioning failed (code ${error.code || 'unknown'}): ${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`,
          output: `Error code: ${error.code || 'unknown'}\n${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error captioning image",
        output: error instanceof Error ? error.message : "Unknown error captioning image"
      };
    }
  }
}
