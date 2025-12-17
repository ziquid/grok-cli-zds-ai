export class VariableDef {
  /**
   * Map of variable names to their definitions
   * Indexed by variable name (e.g., "USER:PRE" -> VariableDef)
   */
  private static definitions: Map<string, VariableDef> = new Map();

  name: string;
  weight: number = 52;
  env_var?: string;
  renderFull: boolean = true;
  persists: boolean = false;
  template: string = "%%";

  constructor(config: {
    name: string;
    weight?: number;
    env_var?: string;
    renderFull?: boolean;
    persists?: boolean;
    template?: string;
  }) {
    Object.assign(this, config);
  }

  /**
   * Get or create definition by name
   * Looks in definitions map, then PROMPT_VARS, then creates default
   * @param name Variable name
   * @returns VariableDef instance
   */
  static getOrCreate(name: string): VariableDef {
    // Check if definition already exists in map
    let def = VariableDef.definitions.get(name);
    if (def) return def;

    // Try to find in PROMPT_VARS template
    const predefined = PROMPT_VARS.find(v => v.name === name);
    if (predefined) {
      VariableDef.definitions.set(name, predefined);
      return predefined;
    }

    // Create default definition and add to map
    def = new VariableDef({ name });
    VariableDef.definitions.set(name, def);
    return def;
  }
}

export class Variable {
  /**
   * Map of variable names to their current values
   * Indexed by variable name (e.g., "USER:PRE" -> Variable)
   */
  private static variables: Map<string, Variable> = new Map();

  def: VariableDef;
  values: string[] = [];
  isNew: boolean = false;

  constructor(name: string) {
    this.def = VariableDef.getOrCreate(name);
  }

  get name(): string {
    return this.def.name;
  }

  get weight(): number {
    return this.def.weight;
  }

  get template(): string {
    return this.def.template;
  }

  get renderFull(): boolean {
    return this.def.renderFull;
  }

  get persists(): boolean {
    return this.def.persists;
  }

  /**
   * Set variable value
   * Creates variable if it doesn't exist
   * @param name Variable name
   * @param value Value to add
   */
  static set(name: string, value: string): void {
    let variable = Variable.variables.get(name);
    if (!variable) {
      variable = new Variable(name);
      Variable.variables.set(name, variable);
    }
    variable.values.push(value);
    variable.isNew = true;
  }

  /**
   * Get variable by name
   * @param name Variable name
   * @returns Variable instance or undefined
   */
  static get(name: string): Variable | undefined {
    return Variable.variables.get(name);
  }

  /**
   * Clear all one-shot variables
   */
  static clearOneShot(): void {
    for (const [name, variable] of Variable.variables.entries()) {
      if (!variable.persists) {
        Variable.variables.delete(name);
      }
    }
  }

  /**
   * Find all full child variables of given parent.  Return sorted.
   *
   * Returns all children of a parent var, sorted by weight,
   * where renderFull == true.
   *
   * @param parent: string
   *   Parent name (e.g., "USER")
   *
   * @returns variables[]
   *   All variables with prefix "parent:", renderFull=true, sorted by weight
   */
  static findFullChildrenVars(parent: string): Variable[] {
    const prefix = `${parent}:`;
    const found: Variable[] = [];

    for (const variable of Variable.variables.values()) {
      if (variable.name.startsWith(prefix) && variable.renderFull) {
        found.push(variable);
      }
    }

    // Sort by weight (primary), then name alphabetically (secondary)
    found.sort((a, b) => {
      if (a.weight !== b.weight) {
        return a.weight - b.weight;
      }
      return a.name.localeCompare(b.name);
    });

    return found;
  }

  /**
   * Render a variable fully (recursive)
   * If variable has children, renders children and joins
   * If variable has no children, renders its template
   * @param name Variable name (e.g., "USER" or "USER:PROMPT")
   * @returns Rendered string
   */
  static renderFull(name: string): string {
    const children = Variable.findFullChildrenVars(name);

    if (children.length > 0) {
      // Has children - render each child recursively
      const parts: string[] = [];
      for (const child of children) {
        parts.push(Variable.renderFull(child.name));
      }
      return parts.join("");
    } else {
      // No children - render this variable's template
      const variable = Variable.get(name);
      if (variable) {
        return variable.renderFullTemplate();
      }
      return "";
    }
  }

  /**
   * Render full value string using template.
   *
   * @returns string
   *   Rendered string
   */
  renderFullTemplate(): string {
    return this.template.replace("%%", this.renderFullValue());
  }

  /**
   * Render full values as a string, from values array.
   *
   * @param separator: string
   *   The string to use as a separator.  Defaults to "\n\n".
   *
   * @returns string
   *   values joined as a string (double-nl-separated)
   */
  renderFullValue(separator: string = "\n\n"): string {
    return this.values.join(separator);
  }
}

const PROMPT_VARS: VariableDef[] = [
  new VariableDef({ name: "USER:PRE", weight: 0, template: "Before you do any processing, please remember:\n%%\n\n" }),
  new VariableDef({
    name: "USER:ENV",
    weight: 10,
    template: "---ENV---\nThe following environment variables have changed since the last prompt:\n\n%%\n\n"
  }),
  new VariableDef({ name: "USER:TIMESTAMP", weight: 11, template: "Current local time: %%\n\n" }),
  new VariableDef({
    name: "USER:RAG",
    weight: 20,
    template: "---RAG---\nThe following data may aid you in performing this request or answering this question:\n\n%%\n\n---USER---\n"
  }),
  new VariableDef({ name: "USER:PROMPT", weight: 50 }),
  new VariableDef({
    name: "USER:GUIDANCE",
    weight: 90,
    template: "\n\n---GUIDANCE---\nUse the following information to guide your response:\n%%"
  }),
  new VariableDef({ name: "USER:POST", weight: 99, template: "\n\n---POST---\nPlease also observe these:\n%%" }),
];
