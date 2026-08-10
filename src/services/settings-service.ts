import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { supabase } from "@/lib/db";

export interface PortalSettings {
  showSystemLogsViewer: boolean;
}

export class SettingsService {
  private static instance: SettingsService;

  static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  private isTableMissingError(error: any): boolean {
    return error && (error.code === "PGRST205" || String(error.message).includes("Could not find the table") || String(error.message).includes("does not exist"));
  }

  private getUploadsRoot() {
    return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
  }

  private getSettingsPath() {
    return join(this.getUploadsRoot(), "portal-settings.json");
  }

  async getSettings(): Promise<PortalSettings> {
    try {
      const { data, error } = await supabase
        .from("portal_settings")
        .select("value")
        .eq("key", "portal_features")
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getSettings error:", error.message);
      } else if (data && data.value) {
        const parsed = data.value as any;
        return {
          showSystemLogsViewer: parsed.showSystemLogsViewer !== false,
        };
      }
    } catch (dbErr) {
      console.warn("SettingsService.getSettings failed, falling back to local file:", dbErr);
    }

    const path = this.getSettingsPath();
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      return {
        showSystemLogsViewer: parsed.showSystemLogsViewer !== false,
      };
    } catch {
      return {
        showSystemLogsViewer: true,
      };
    }
  }

  async updateSettings(settings: Partial<PortalSettings>): Promise<PortalSettings> {
    const current = await this.getSettings();
    const updated = {
      ...current,
      ...settings,
    };

    try {
      const { error } = await supabase
        .from("portal_settings")
        .upsert({
          key: "portal_features",
          value: updated,
        });

      if (error) throw error;
    } catch (dbErr) {
      console.warn("SettingsService.updateSettings failed, falling back to local file:", dbErr);
    }

    const path = this.getSettingsPath();
    await mkdir(this.getUploadsRoot(), { recursive: true });
    await writeFile(path, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }
}

export const settingsService = SettingsService.getInstance();
