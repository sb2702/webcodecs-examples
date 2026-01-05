/// <reference types="vite/client" />

// Vite worker imports (inline as constructor)
declare module '*?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// Vite worker URL imports (separate file)
declare module '*?worker&url' {
  const workerUrl: string;
  export default workerUrl;
}
