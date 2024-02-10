import { compile, optimize, showError, toSVG } from "@penrose/core/bundle";
import { App, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface Alias {
    domain: string;
    style: string;
}

interface AliasConfig {
    [alias: string]: Alias;
}

interface PenroseSettings {
  mySetting: string;
  aliases: AliasConfig;
}

const DEFAULT_SETTINGS: PenroseSettings = {
  mySetting: "default",
  aliases: {},
};

export default class PenrosePlugin extends Plugin {
  settings: PenroseSettings;
  async onload() {
    await this.loadSettings();

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new PenroseSettingTab(this.app, this));

    // register the code block processor for penrose
    this.registerMarkdownCodeBlockProcessor(
      "penrose",
      async (source: string, el, ctx) => {
        // get the trio by reading file links in the metadata
        const trio = await getTrio(source, async (path: string) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            try {
              const fileContents = await this.app.vault.read(file);
              return fileContents;
            } catch (error) {
              const msg = `Error reading file ${path}: ${error}`;
              console.error(msg);
              el.appendChild(document.createTextNode(msg));
              return "";
            }
          } else {
            const msg = `Error reading file ${path}`;
            el.appendChild(document.createTextNode(msg));
            return "";
          }
        });

        // do the actual compilation and layout, reporting errors as we go
        const compiled = await compile(trio);
        if (compiled.isErr()) {
          console.error(compiled.error);
          el.appendChild(document.createTextNode(showError(compiled.error)));
        } else {
          const optimized = optimize(compiled.value);
          if (optimized.isErr()) {
            console.error(optimized.error);
            el.appendChild(document.createTextNode(showError(optimized.error)));
          } else {
            const rendered = await toSVG(
              optimized.value,
              async () => undefined,
              "penrose-obsidian",
            );
            el.appendChild(rendered);
          }
        }
      },
    );
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

type Meta = {
  style: string;
  domain: string;
  variation: string;
};

// helper function that extracts metadata of domain path, style path, and variation from a substance source
const extractMetadata = async (substance: string): Promise<Meta> => {
  // Regular expressions for each key
  const alias = /--\s*alias:(.*)/;
  const domainRegex = /--\s*domain:(.*)/;
  const styleRegex = /--\s*style:(.*)/;
  const variationRegex = /--\s*variation:(.*)/;

  // Split the program into lines
  const lines = substance.split("\n");

  // Initialize an object to store the results
  let domain = "";
  let style = "";
  let variation = "";
  let aliasName = "";
  
  // Iterate over each line and extract the values
  lines.forEach(async (line) => {
    const aliasMatch = line.match(alias);
    if (aliasMatch) {
      aliasName = aliasMatch[1].trim();
      const aliasConfig = this.plugin.settings.aliases[aliasName];
      if (aliasConfig) {
        domain = aliasConfig.domain;
        style = aliasConfig.style;
      }
    }

    const domainMatch = line.match(domainRegex);
    if (domainMatch) {
      domain = domainMatch[1].trim();
    }

    const styleMatch = line.match(styleRegex);
    if (styleMatch) {
      style = styleMatch[1].trim();
    }

    const variationMatch = line.match(variationRegex);
    if (variationMatch) {
      variation = variationMatch[1].trim();
    }
  });
  return { style, domain, variation };
};

// from a substance file, extract the metadata and read the domain and style files by following the links in the metadata
const getTrio = async (
  source: string,
  readFile: (path: string) => Promise<string>,
): Promise<{
  substance: string;
  style: string;
  domain: string;
  variation: string;
}> => {
  const res = await extractMetadata(source);
  const style = await readFile(res.style);
  const domain = await readFile(res.domain);
  return {
    substance: source,
    style,
    domain,
    variation: res.variation,
  };
};

// Settings tab
class PenroseSettingTab extends PluginSettingTab {
  plugin: PenrosePlugin;

  constructor(app: App, plugin: PenrosePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Alias Settings' });

    const aliasConfigContainer = containerEl.createEl('div', { cls: 'alias-config-container' });

    // Display existing aliases and allow editing/deleting
    const aliases = this.plugin.settings.aliases;
    for (const alias in aliases) {
      const aliasObj = aliases[alias];
      const aliasSettingsContainer = aliasConfigContainer.createEl('div', { cls: 'alias-settings-container' });

      const aliasNameInput = new Setting(aliasSettingsContainer)
        .setName('Alias Name')
        .setDesc('Enter the name of the alias')
        .addText(text => text
          .setPlaceholder('Alias Name')
          .setValue(alias)
          .onChange(value => {
              // TODO: Implement renaming
              
          })
        );

      const aliasDomainInput = new Setting(aliasSettingsContainer)
        .setName('Domain')
        .setDesc('Enter the domain for the alias')
        .addText(text => text
          .setPlaceholder('Enter domain')
          .setValue(aliasObj.domain)
          .onChange(value => {
              this.plugin.settings.aliases[alias].domain = value;
              this.plugin.saveData(this.plugin.settings);
          })
        );

      const aliasStyleInput = new Setting(aliasSettingsContainer)
        .setName('Style')
        .setDesc('Enter the style for the alias')
        .addText(text => text
          .setPlaceholder('Enter style')
          .setValue(aliasObj.style)
          .onChange(value => {
              this.plugin.settings.aliases[alias].style = value;
              this.plugin.saveData(this.plugin.settings);
          })
        );

      const deleteButton = aliasSettingsContainer.createEl('button', { text: 'Delete', cls: 'delete-button' });
      deleteButton.onclick = () => {
        delete this.plugin.settings.aliases[alias];
        this.plugin.saveData(this.plugin.settings);
        aliasSettingsContainer.remove();
      };
      
    }


    const addButton = aliasConfigContainer.createEl('button', { text: 'Add Alias' });
    addButton.onclick = () => {
        const newAliasName = `alias${Object.keys(this.plugin.settings.aliases).length + 1}`;
        if (newAliasName) {
            this.plugin.settings.aliases[newAliasName] = { domain: '', style: '' };
            this.plugin.saveData(this.plugin.settings);
            this.display(); // Refresh UI
        }
    };
  }
}
