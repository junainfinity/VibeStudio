/**
 * Minimal typings for bpmn-moddle@10, which ships no declarations for its
 * root export (its "./types" entry only exposes generated element interfaces,
 * not the factory). Only the surface the tests use is declared. NOTE: since
 * v10 the package has a NAMED export `BpmnModdle` (a factory function, no
 * default export), which is why the tests do not use `import BpmnModdle from`.
 */
declare module "bpmn-moddle" {
  export interface ModdleElement {
    $type: string;
    id?: string;
    get(name: string): unknown;
  }

  export interface FromXmlResult {
    rootElement: ModdleElement;
    warnings: unknown[];
  }

  export interface Moddle {
    fromXML(xml: string, typeName?: string): Promise<FromXmlResult>;
  }

  export function BpmnModdle(
    additionalPackages?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Moddle;
}
