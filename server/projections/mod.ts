// projections/mod.ts
// Event projections barrel

export {
  makeProjectionLayer,
  makeProjectionTag,
  type Projection,
} from "./projection.ts";

export {
  createInjectorError,
  type Injector,
  type InjectorError,
  type InjectorErrorCode,
  makeInjectionLayer,
  makeInjectorTag,
} from "./injector.ts";
