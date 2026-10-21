declare module 'occt-import-js' {
  export interface OcctBrepFace {
    first: number;
    last: number;
    color: [number, number, number] | null;
  }

  export interface OcctMeshAttributes {
    position: {
      array: number[] | Float32Array;
    };
    normal?: {
      array: number[] | Float32Array;
    };
  }

  export interface OcctMesh {
    name: string;
    attributes: OcctMeshAttributes;
    index: {
      array: number[] | Uint32Array;
    };
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
  }

  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }

  export interface OcctResult {
    success: boolean;
    root?: OcctNode;
    meshes?: OcctMesh[];
  }

  export interface OcctImportParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctModuleOverrides {
    locateFile?: (path: string, prefix?: string) => string;
    [key: string]: unknown;
  }

  export interface OcctModule {
    ReadFile(format: string, buffer: Uint8Array | ArrayBuffer, params: OcctImportParams | null): OcctResult;
    ReadStepFile(buffer: Uint8Array | ArrayBuffer, params: OcctImportParams | null): OcctResult;
    ReadIgesFile(buffer: Uint8Array | ArrayBuffer, params: OcctImportParams | null): OcctResult;
    ReadBrepFile(buffer: Uint8Array | ArrayBuffer, params: OcctImportParams | null): OcctResult;
  }

  function occtimportjs(overrides?: OcctModuleOverrides): Promise<OcctModule>;
  export default occtimportjs;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}
