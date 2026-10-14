# Infraestructura de Domu

## Selección del sistema gestor de bases de datos

Para el proyecto Domu, se ha seleccionado MySQL como Sistema Gestor de Bases de Datos Relacionales. Esta elección se fundamenta en la robustez, su amplia adopción en entornos web y su excelente integración con arquitecturas basadas en contenedores.

### Modelo Relacional
La naturaleza de los datos de Domu requiere una estructura consistente mediante tablas relacionadas.

### Rendimiento y escalabilidad
MySQL ofrece una alta velocidad de lectura y un consumo de recursos equilibrado, ideal para ser desplegado en el mismo servidor que el servidor de aplicaciones.

### Compatibilidad con Docker
Existe una imagen oficial de MySQL muy optimizada, lo que facilita la portabilidad y la automatización del despliegue mediante Docker Compose.

## Frameworks

El desarrollo de Domu se fundamenta en una arquitectura de separación de responsabilidades, utilizando un stack tecnológico basado en JavaScript/TypeScript de extremo a extremo. Esto permite una mayor fluidez en el intercambio de datos y una gestión unificada del ciclo de vida del desarrollo.

### Capa Cliente: React.js

Para la interfaz de usuario, se ha seleccionado React.js, una librería de código abierto liderada por Meta, debido a su enfoque basado en componentes reutilizables.
- **Virtual DOM:** React optimiza el rendimiento mediante el uso de un DOM (Document Object Model) virtual, lo que permite actualizaciones de la interfaz extremadamente rápidas al renderizar solo los componentes que sufren cambios.
- **Arquitectura basada en componentes:** Facilita el mantenimiento del código al encapsular la lógica y el diseño en piezas independientes (botones, formularios, vistas), lo que acelera el desarrollo de la interfaz.
- **Ecosistema y comunidad:** La amplia disponibilidad de librerías para la gestión de rutas (React Router) y el estado de la aplicación asegura una solución escalable.
