// =============================================================
// Enum de roles de usuario
// =============================================================
//
// Fuente única de verdad para los roles de la aplicación. Los
// valores coinciden con el CHECK `chk_users_role` de
// `001_init.sql` (`role IN ('NEIGHBOR', 'PRESIDENT')`).
//
// No existe rol `ADMIN`/`ADMINISTRATOR`
// Los objetos se exportan congelados: intentar añadir, borrar o
// reasignar una propiedad en tiempo de ejecución no tiene efecto
// (y en modo estricto lanza `TypeError`).
// =============================================================

/**
 * Constante: Role
 * Propósito: roles admitidos por la API.
 * @type {Readonly<{ NEIGHBOR: "NEIGHBOR", PRESIDENT: "PRESIDENT" }>}
 */
export const Role = Object.freeze({
  NEIGHBOR: "NEIGHBOR",
  PRESIDENT: "PRESIDENT",
});

/**
 * Constante: ROLE_VALUES
 * Propósito: lista blanca de valores, congelada, para validaciones
 * y para el middleware `authorizeRoles`.
 * @type {ReadonlyArray<string>}
 */
export const ROLE_VALUES = Object.freeze(Object.values(Role));

/**
 * Función: isRole
 * Propósito: comprobar que un valor es un rol válido.
 * @param {unknown} value - Valor a comprobar.
 * @returns {boolean} `true` si es `NEIGHBOR` o `PRESIDENT`.
 */
export function isRole(value) {
  return typeof value === "string" && ROLE_VALUES.includes(value);
}
