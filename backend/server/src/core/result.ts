// src/core/result.ts
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const mapResult = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => {
  return result.ok ? Ok(fn(result.value)) : result;
};

export const flatMapResult = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => {
  return result.ok ? fn(result.value) : result;
};

// flatMap with error type transformation
export const flatMapResultWithErrorMap = <T, U, E1, E2>(
  result: Result<T, E1>,
  fn: (value: T) => Result<U, E2>,
  errorMap: (error: E1) => E2,
): Result<U, E2> => {
  if (result.ok) {
    return fn(result.value);
  } else {
    return Err(errorMap(result.error));
  }
};

export const isOk = <T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } => {
  return result.ok;
};

export const isErr = <T, E>(
  result: Result<T, E>,
): result is { ok: false; error: E } => {
  return !result.ok;
};
