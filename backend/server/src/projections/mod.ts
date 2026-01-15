// projections/mod.ts
// Event projections barrel

export {
  EventStoreEffect,
  makeProjection,
  makeProjectionEffect,
  type Projection,
} from "./projection.ts";

export {
  createInjectorError,
  type Injector,
  type InjectorError,
  type InjectorErrorCode,
  makeInjector,
  makeInjectorEffect,
  makeInjectorTag,
} from "./injector.ts";
