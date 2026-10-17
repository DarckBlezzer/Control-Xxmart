# 📱 Mirage Smart AC v2 (Vue 3 + Capacitor)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883.svg?logo=vue.js)](https://vuejs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-8.0-119eff.svg?logo=capacitor)](https://capacitorjs.com/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646cff.svg?logo=vite)](https://vitejs.dev/)

> **Reemplazo moderno, rápido, ultraligero y de código abierto para la aplicación oficial de Mirage Air Conditioners (plataforma Midea IoT).**  
> Diseñada para corregir de raíz los constantes cierres de sesión y la falta de respuesta táctil en los controles del dispositivo.

---

## 📑 Tabla de Contenidos
1. [Resumen y Comparativa](#-resumen-y-comparativa)
2. [Diagnóstico de Fallas de la App Original](#-diagnóstico-de-fallas-de-la-app-original)
3. [Ingeniería Inversa y Protocolo Extraído](#-ingeniería-inversa-y-protocolo-extraído)
4. [Estructura del Proyecto](#-estructura-del-proyecto)
5. [Instalación del APK](#-instalación-del-apk)
6. [Guía de Compilación y Desarrollo](#-guía-de-compilación-y-desarrollo)
7. [Privacidad y Seguridad](#-privacidad-y-seguridad)
8. [Licencia](#-licencia)

---

## 🌟 Resumen y Comparativa

| Característica | App Oficial Mirage (`com.mirage.ac`) | Mirage Smart AC v2 |
| :--- | :--- | :--- |
| **Tamaño del instalador** | ~45.1 MB (pesada, código legado) | **~4.1 MB** (ultraligera y optimizada) |
| **Persistencia de sesión** | Expira constantemente; expulsa al login | **100% Persistente** con auto-reautenticación silenciosa en background |
| **Respuesta de botones** | Lenta, congela la pantalla o descarta clics | **Instantánea (0 ms)** con UI optimista y respuesta háptica (vibración) |
| **Control de peticiones** | Peticiones simultáneas sin control de colisión | **Cola secuencial (FIFO) con Debounce de 300 ms** |
| **Control de ventilas (Swing)** | Sweep básico | **Sweep + 5 Posiciones fijas independientes (Vertical y Horizontal)** |
| **Modo Silencioso (Beep)** | No explicado en la interfaz | **Control transparente vinculado a Pantalla LED** |
| **Tecnología** | Monolito nativo con SDK antiguo | **Vue 3 + Vite + Capacitor 8 + Lucide Icons** |
| **Modo Demostración** | No disponible (requiere cuenta y WiFi activa) | **Incluido** para explorar toda la interfaz offline |

---

## 🔍 Diagnóstico de Fallas de la App Original

Tras descompilar las clases DEX (`classes.dex` y `classes2.dex`) y analizar el binario de recursos (`resources.arsc`) de la aplicación original de Mirage, se identificaron las dos fallas técnicas principales:

### 1. "Siempre se sale de la sesión"
- **Origen técnico:** El servidor de la nube Midea Cloud asigna una vigencia temporal al `sessionId`. Cuando el token vence (códigos de error `3101`, `3102`, `3106` o HTTP 401), la app original no ejecutaba ninguna renovación en segundo plano. En su lugar, borraba la memoria local y forzaba el redireccionamiento a `LoginActivity`.
- **Solución implementada:** [`sessionManager.js`](src/services/sessionManager.js) almacena de forma segura las credenciales en almacenamiento persistente nativo (`@capacitor/preferences`). Cada petición pasa por un interceptor: si el servidor reporta sesión expirada, la aplicación ejecuta un `silentRelogin()` transparente en milisegundos y reintenta el comando original sin interrumpir al usuario. Adicionalmente, emite un *keep-alive ping* cada 10 minutos.

### 2. "A veces no funcionan los botones"
- **Origen técnico:** Al pulsar rápidamente botones (como cambiar de 22°C a 24°C), la app original emitía peticiones HTTP concurrentes. El microcontrolador del aire acondicionado y el servidor Midea rechazan tramas transparentes simultáneas o responden fuera de orden, sobreescribiendo el estado con datos desfasados. Además, bloqueaba los escuchadores táctiles mientras esperaba la respuesta de red (1 a 3 segundos).
- **Solución implementada:** [`commandQueue.js`](src/services/commandQueue.js) implementa:
  - **Respuesta visual y háptica inmediata:** La pantalla se actualiza en 0 ms y emite una micro-vibración táctil mediante `@capacitor/haptics`.
  - **Debounce:** Las pulsaciones consecutivas se consolidan en un único paquete limpio tras 300 ms.
  - **Transmisión secuencial (FIFO):** Garantiza que cada paquete binario se envíe y confirme antes del siguiente.

---

## 🔐 Ingeniería Inversa y Protocolo Extraído

Del análisis del SDK de MSmart (`OppSecurityUtils` y `BaseAPI`) se extrajeron los parámetros base del fabricante:

```javascript
export const API_CONFIG = {
  APP_ID: '1017',
  APP_KEY: '3742e9e5842d4ad59c2db887e12449f9',
  SRC: '17',
  FORMAT: '2',
  CLIENT_TYPE: '1', // Android Client
  BASE_URL: 'https://mapp.appsmb.com/v1',
  FALLBACK_URL: 'http://mapp.appsmb.com:10050/v1'
};
```

### Algoritmos Criptográficos Replicados

1. **Cifrado de Contraseña (`loginEncrypt`):**
   $$\text{SHA256}(\text{loginId} + \text{SHA256}(\text{password}) + \text{appKey})$$
2. **Firma de Petición HTTP (`requestSign`):**
   $$\text{SHA256}(\text{URI} + \text{QueryStringOrdenadoAlfabéticamente} + \text{appKey})$$
3. **Descifrado de Tokens de Sesión (`accessToken` y `randomData`):**
   - El endpoint `/v1/user/login` devuelve tokens cifrados.
   - Modo principal MSmart: $\text{AES-128-ECB}(\text{Key}=\text{MD5}(\text{appKey})[0..16])$.
   - Modo alternativo: $\text{AES-128-CBC}(\text{Key}=\text{SHA256}(\text{appKey})[0..16], \text{IV}=\text{SHA256}(\text{appKey})[16..32])$.
4. **Empaquetado y Cifrado de Tramas Transparentes (`sendTransparentCmd`):**
   - Las tramas binarias (`0xAC`) de 33/36 bytes se encapsulan dentro de una trama envolvente de 89 bytes (protocolo 8370) con cabecera `0x5A5A`, ID de aparato en *little-endian*, secuencia, timestamp y padding.
   - El paquete se cifra mediante $\text{AES-128}(\text{Key}=\text{accessToken})$ y se envía a `/v1/appliance/transparent/send` con firma SHA-256.
   - Las respuestas del servidor Midea (`reply`) se descifran con AES-128 para extraer la telemetría en tiempo real (temperatura interior, temperatura exterior, estado de compresor, etc.).
5. **Traducción de Códigos del Servidor:**
   - Diccionario de errores de Midea (`3002`, `3004`, `3101`, `3176`, etc.) traducidos de chino a mensajes comprensibles en español.

---

## 📂 Estructura del Proyecto

```
Control-Xxmart/
├── android/                         # Proyecto nativo Android (Gradle + Capacitor Bridge)
│   ├── app/
│   │   ├── build.gradle             # Configurado con Java 17 y signing debug para releases
│   │   └── src/main/                # AndroidManifest, iconos y splash screen
│   ├── build.gradle                 # Configuración de compilación raíz
│   ├── gradle.properties            # Propiedades de JVM y AndroidX
│   └── gradlew.bat                  # Wrapper portable de Gradle
├── public/                          # Iconos y recursos estáticos
├── release/                         # Directorio de salida único de producción
│   └── app-release.apk              # APK optimizada y firmada lista para instalar (~3.1 MB)
├── src/                             # Código fuente de la aplicación Vue 3
│   ├── App.vue                      # Componente principal con ciclo de vida y sincronización
│   ├── style.css                    # Estilos modernos dark-mode y feedback táctil
│   ├── components/
│   │   ├── AirConditioner.vue       # Termostato circular, barra de abanico, modos y ventilas
│   │   └── LoginModal.vue           # Pantalla de inicio de sesión seguro y modo demo
│   └── services/
│       ├── commandQueue.js          # Cola optimista con debounce y háptica
│       ├── crypto.js                # SHA-256, MD5, AES y empaquetador de tramas 8370
│       ├── mideaApi.js              # Cliente HTTP hacia la nube Midea/Mirage
│       ├── mideaProtocol.js         # Constructor y decodificador de tramas 0xAC
│       └── sessionManager.js        # Gestor de sesión persistente y auto-relogin
├── capacitor.config.json            # Configuración nativa con CapacitorHttp activado
├── index.html                       # Entrada HTML de la SPA
├── package.json                     # Dependencias (Vue 3, Vite, Capacitor 8, Lucide)
├── test_midea_crypto.js             # Pruebas unitarias de cifrado y tramas
└── vite.config.js                   # Configuración del bundler Vite con proxy de desarrollo
```

---

## 📱 Instalación del APK

### Opción A: Descarga directa (Recomendada)
1. Descarga el archivo `app-release.apk` desde la sección de [Releases](https://github.com/DarckBlezzer/Control-Xxmart/releases).
2. Pásalo a tu celular (o descárgalo directamente desde el navegador de tu teléfono).
3. Pulsa sobre el archivo `.apk` e instálalo (permite "Instalar aplicaciones de fuentes desconocidas" si Android lo solicita).
4. Inicia sesión con tu cuenta habitual de Mirage / Midea.
5. *(Opcional)* Puedes presionar **"Probar Modo Demostración (Offline)"** para probar la interfaz sin necesidad de conectar tu aire acondicionado.

### Opción B: Instalación por USB (ADB)
Si tienes depuración USB activada en tu celular:
```cmd
adb install -r release\app-release.apk
adb shell am start -n com.mirage.smartac/.MainActivity
```

---

## 🛠️ Guía de Compilación y Desarrollo

### Requisitos previos
- [Node.js](https://nodejs.org/) (versión 18 o superior)
- [JDK 17](https://adoptium.net/) (Java Development Kit 17)
- [Android Studio](https://developer.android.com/studio) con Android SDK instalado

### 1. Clonar e instalar dependencias
```powershell
git clone https://github.com/DarckBlezzer/Control-Xxmart.git
cd Control-Xxmart
npm install
```

### 2. Ejecutar en navegador (Modo desarrollo)
```powershell
npm run dev
```
Abre en tu navegador `http://localhost:5173`. Las llamadas a `/v1` son redirigidas por el proxy de Vite directamente al servidor de Mirage sin restricciones de CORS.

### 3. Compilar APK de Producción (`app-release.apk`)

#### Opción rápida (un solo comando con npm):
```powershell
npm run build:apk
```

#### Opción manual paso a paso:
```powershell
# 1. Compilar aplicación web
npm run build

# 2. Sincronizar assets con Android
npx cap sync

# 3. Compilar APK con Gradle
cd android
.\gradlew.bat assembleRelease
```
El instalador final generado y firmado se copiará automáticamente a:  
📁 `release/app-release.apk` (Tamaño optimizado: ~3.1 MB)

---

## 🔒 Privacidad y Seguridad

- **Cero telemetría ni rastreo:** Esta aplicación no incluye servicios de analítica de terceros, librerías de publicidad ni telemetría invasiva.
- **Conexión directa:** Las credenciales y comandos se envían única y exclusivamente a los servidores oficiales de Mirage / Midea Cloud (`mapp.appsmb.com`) mediante HTTPS cifrado.
- **Almacenamiento seguro en el dispositivo:** La sesión y credenciales se guardan localmente en el almacenamiento seguro privado de tu propio celular a través de `@capacitor/preferences`.
- **Transparencia:** Todo el código fuente está abierto para inspección y auditoría independiente.

---

## 📄 Licencia

Este proyecto es software libre y de código abierto bajo la licencia [Apache 2.0](LICENSE).
