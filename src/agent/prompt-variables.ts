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
  adoptedChildren: string[] = [];
  getter?: () => string;

  constructor(config: {
    name: string;
    weight?: number;
    env_var?: string;
    renderFull?: boolean;
    persists?: boolean;
    template?: string;
    getter?: () => string;
  }) {
    Object.assign(this, config);

    // Parse template for %VAR% references (adopted children)
    if (this.template) {
      const regex = /%([A-Z_:]+)%/g;
      let match;
      while ((match = regex.exec(this.template)) !== null) {
        const varName = match[1];
        if (varName !== "" && !this.adoptedChildren.includes(varName)) {
          this.adoptedChildren.push(varName);
        }
      }
    }
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
   * Find birth child variables of given parent.  Return sorted.
   *
   * Returns birth children (prefix match) of a parent var, sorted by weight,
   * where renderFull == true.
   *
   * @param parent: string
   *   Parent name (e.g., "USER" or "SYSTEM")
   *
   * @returns variables[]
   *   All variables with prefix "parent:", renderFull=true, sorted by weight
   */
  static findBirthChildren(parent: string): Variable[] {
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
   * Find all full child variables of given parent.  Return sorted.
   *
   * Returns all children of a parent var, sorted by weight,
   * where renderFull == true.  Includes both birth children
   * (prefix match "parent:") and adopted children (from template).
   *
   * @param parent: string
   *   Parent name (e.g., "USER")
   *
   * @returns variables[]
   *   All variables with prefix "parent:", renderFull=true, sorted by weight
   */
  static findFullChildrenVars(parent: string): Variable[] {
    const found: Variable[] = [];

    // Find birth children (prefix match)
    found.push(...Variable.findBirthChildren(parent));

    // Find adopted children (from parent's template)
    const parentDef = VariableDef.getOrCreate(parent);
    for (const adoptedName of parentDef.adoptedChildren) {
      const adoptedVar = Variable.get(adoptedName);
      if (adoptedVar && adoptedVar.renderFull && !found.includes(adoptedVar)) {
        found.push(adoptedVar);
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
   * If variable exists, renders its template (which may reference children)
   * If variable doesn't exist but children do, renders children and joins
   * If variable doesn't exist but has a getter, auto-creates it
   * @param name Variable name (e.g., "USER" or "USER:PROMPT")
   * @param renderingStack Set of variables currently being rendered (for cycle detection)
   * @returns Rendered string
   */
  static renderFull(name: string, renderingStack: Set<string> = new Set()): string {
    // Check for circular dependency
    if (renderingStack.has(name)) {
      const parent = Array.from(renderingStack).pop() || "unknown";
      return `ERROR: ${name} already rendered, refusing to render as child of ${parent}`;
    }

    // Add to stack
    renderingStack.add(name);

    let variable = Variable.get(name);
    let result = "";

    // If variable doesn't exist but definition has getter, auto-create it
    if (!variable) {
      const def = VariableDef.getOrCreate(name);
      if (def.getter) {
        variable = new Variable(name);
        Variable.variables.set(name, variable);
      }
    }

    if (variable) {
      // Variable exists - render its template
      result = variable.renderFullTemplate(renderingStack);
    } else {
      // Variable doesn't exist - check if it has children or getter
      const def = VariableDef.getOrCreate(name);
      const children = Variable.findFullChildrenVars(name);

      if (children.length > 0 || def.getter) {
        // Create the variable instance so it can render properly
        variable = new Variable(name);
        Variable.variables.set(name, variable);
        result = variable.renderFullTemplate(renderingStack);
      }
    }

    // Remove from stack
    renderingStack.delete(name);

    return result;
  }

  /**
   * Render full value string using template.
   *
   * @param renderingStack Set of variables currently being rendered (for cycle detection)
   * @returns string
   *   Rendered string
   */
  renderFullTemplate(renderingStack: Set<string> = new Set()): string {
    let rendered = this.template;
    const isDefaultTemplate = this.template === "%%";

    // First, substitute %VAR% patterns (adopted children)
    rendered = rendered.replace(/%([A-Z_:]+)%/g, (match, varName) => {
      if (varName === "") return match;
      return Variable.renderFull(varName, renderingStack);
    });

    // Then, substitute %% with own values + birth children
    const birthChildren = Variable.findBirthChildren(this.name);
    const birthRendered = birthChildren
      .map(child => Variable.renderFull(child.name, renderingStack))
      .join("");
    const ownValues = this.renderFullValue();
    rendered = rendered.replace("%%", ownValues + birthRendered);

    // If using default template and has birth children, wrap with XML tags
    if (isDefaultTemplate && birthChildren.length > 0) {
      const tagName = this.name.toLowerCase().replace(/:/g, "-");
      rendered = `<${tagName}>\n${rendered}\n</${tagName}>\n`;
    }

    return rendered;
  }

  /**
   * Render full values as a string, from values array.
   *
   * If this variable has a getter function, computes the current value
   * and updates values array only if the value changed (sets isNew flag).
   *
   * After rendering, clears the isNew flag since the variable has been consumed.
   *
   * ASSUMPTION: Getter functions always return a single string value,
   * never an array. If this assumption changes, this logic needs revision.
   *
   * @param separator: string
   *   The string to use as a separator.  Defaults to "\n\n".
   *
   * @returns string
   *   values joined as a string (double-nl-separated)
   */
  renderFullValue(separator: string = "\n"): string {
    // If this variable has a getter, update value dynamically
    if (this.def.getter) {
      const newValue = this.def.getter();
      const oldValue = this.values[0];

      // Only update if value changed
      if (oldValue !== newValue) {
        this.values = [newValue];
        this.isNew = true;
      }
    }

    const result = this.values.join(separator);

    // Clear isNew flag after rendering (variable has been consumed)
    this.isNew = false;

    return result;
  }
}

const PROMPT_VARS: VariableDef[] = [
  new VariableDef({ name: "ZDS:PRE", weight: 0 }),
  new VariableDef({ name: "USER:PRE", weight: 0, template: "<pre explanation=\"Before you do any processing, please remember:\">\n%%\n</pre>\n" }),
  new VariableDef({
    name: "USER:ENV",
    weight: 10,
    template: "<env explanation=\"The following environment variables have changed since the last prompt:\">\n%%\n</env>\n"
  }),
  new VariableDef({ name: "USER:TIMESTAMP", weight: 11, template: "<timestamp explanation=\"Current local time:\">%%</timestamp>\n" }),
  new VariableDef({
    name: "USER:RAG",
    weight: 20,
    template: "<rag explanation=\"The following data may aid you in performing this request or answering this question:\">\n%%\n</rag>\n"
  }),
  new VariableDef({ name: "USER:PROMPT", weight: 50 }),
  new VariableDef({
    name: "USER:GUIDANCE",
    weight: 90,
    template: "\n<guidance explanation=\"Use the following information to guide your response:\">\n%%\n</guidance>\n"
  }),
  new VariableDef({ name: "USER:POST", weight: 99, template: "\n<post explanation=\"Please also observe these:\">\n%%\n</post>\n" }),
  new VariableDef({
    name: "MESSAGE",
    weight: 60,
    template: "%%"
  }),
  new VariableDef({ name: "MESSAGE:ACL:CURRENT", template: "<current>%%</current>\n" }),
  new VariableDef({ name: "MESSAGE:AUTHOR", template: "<author>%%</author>\n" }),
  new VariableDef({ name: "MESSAGE:CHANNEL", template: "<channel>%%</channel>\n" }),
  new VariableDef({ name: "MESSAGE:TANGENT:IS_TANGENT", template: "<is-tangent>%%</is-tangent>\n" }),
  new VariableDef({ name: "MESSAGE:ACL:MAX", template: "<max>%%</max>\n" }),
  new VariableDef({ name: "MESSAGE:MEMBERS", template: "<members>%%</members>\n" }),
  new VariableDef({ name: "MESSAGE:PRIVACY", template: "<privacy>%%</privacy>\n" }),
  new VariableDef({ name: "MESSAGE:RESPONSE_TYPES:ACCEPTED", template: "<accepted>%%</accepted>\n" }),
  new VariableDef({ name: "MESSAGE:RESPONSE_TYPES:FORBIDDEN", template: "<forbidden>%%</forbidden>\n" }),
  new VariableDef({ name: "MESSAGE:SERVER", template: "<server>%%</server>\n" }),
  new VariableDef({ name: "MESSAGE:SOURCE", template: "<source>%%</source>\n" }),
  new VariableDef({ name: "MESSAGE:TANGENT:NAME", template: "<name>%%</name>\n" }),
  new VariableDef({ name: "MESSAGE:TIMESTAMP", template: "<timestamp>%%</timestamp>\n" }),
  new VariableDef({
    name: "SYSTEM",
    template: "<zds-pre>%ZDS:PRE%</zds-pre>\n<org>%ORG%</org>\n<job>%JOB%</job>\n<char>%CHAR%</char>\n<project>%PROJECT%</project>\n<task>%TASK%</task>\n<message>%MESSAGE%</message>\n<backend>%BACKEND%</backend>\n<app>%APP%</app>\n<zds-post>%ZDS:POST%</zds-post>\n%%"
  }),
  new VariableDef({ name: "ZDS:POST", weight: 99 }),
  new VariableDef({
    name: "APP:TOOLS",
    weight: 70,
    persists: true,
    template: "<tools>%%</tools>\n"
  }),
  new VariableDef({
    name: "APP:CWD",
    weight: 80,
    persists: true,
    template: "<current-working-directory>%%</current-working-directory>\n",
    getter: () => process.cwd()
  }),
];
