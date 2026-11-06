/**
 * Reglas de arquitectura (dependency-cruiser) del puente.
 * Se ejecutan con: npm run arch
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-exterior',
      severity: 'error',
      comment: 'El dominio solo puede depender de otros módulos del dominio.',
      from: { path: '^apps/bridge/src/domain/' },
      to: { pathNot: '^apps/bridge/src/domain/' },
    },
    {
      name: 'domain-no-core',
      severity: 'error',
      comment: 'El dominio no puede depender de módulos del core de Node.',
      from: { path: '^apps/bridge/src/domain/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'application-no-exterior',
      severity: 'error',
      comment: 'La aplicación solo puede depender de dominio y de sí misma.',
      from: { path: '^apps/bridge/src/application/' },
      to: { pathNot: '^apps/bridge/src/(application|domain)/' },
    },
    {
      name: 'application-no-core',
      severity: 'error',
      comment: 'La aplicación no puede depender de módulos del core de Node.',
      from: { path: '^apps/bridge/src/application/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'adapters-no-other-family',
      severity: 'error',
      // adapters/shared es el único módulo transversal permitido: cualquier
      // adaptador puede importarlo, pero no puede importar otras familias.
      comment:
        'Cada adaptador solo puede depender de su propia familia y de adapters/shared.',
      from: { path: '^apps/bridge/src/adapters/([^/]+)/' },
      to: { path: '^apps/bridge/src/adapters/(?!$1|shared/)' },
    },
    {
      name: 'config-no-adapters',
      severity: 'error',
      comment: 'La configuración no puede depender de adaptadores concretos.',
      from: { path: '^apps/bridge/src/config/' },
      to: { path: '^apps/bridge/src/adapters/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No se permiten dependencias circulares.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'main-no-adapters',
      severity: 'error',
      comment: 'main.ts solo compone: los adaptadores se instancian en composition/.',
      from: { path: '^apps/bridge/src/main\\.ts$' },
      to: { path: '^apps/bridge/src/adapters/' },
    },
    {
      name: 'no-import-main',
      severity: 'error',
      comment: 'Nadie importa el punto de entrada main.ts.',
      from: {},
      to: { path: '^apps/bridge/src/main\\.ts$' },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Módulos huérfanos: todo módulo debe estar conectado al grafo.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '\\.test\\.ts$', 'main\\.ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
}
