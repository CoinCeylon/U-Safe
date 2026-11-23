export type RouteParams = Record<string, string>;

export type RouteHandler = (params: RouteParams) => Node | string | void;

export interface RouteDefinition {
  path: string;
  handler: RouteHandler;
}

export interface RouterOptions {
  notFound?: (path: string) => Node | string | void;
}

let currentRouter: HashRouter | null = null;

function setCurrentRouter(router: HashRouter | null): void {
  currentRouter = router;
}

export class HashRouter {
  private readonly outlet: HTMLElement;
  private readonly routes: RouteDefinition[] = [];
  private notFoundHandler: (path: string) => Node | string | void;
  private started = false;
  private readonly onHashChange = (): void => {
    this.render();
  };

  constructor(outlet: HTMLElement, options: RouterOptions = {}) {
    this.outlet = outlet;
    this.notFoundHandler = options.notFound ?? defaultNotFound;
    setCurrentRouter(this);
  }

  register(path: string, handler: RouteHandler): this;
  register(route: RouteDefinition): this;
  register(pathOrRoute: string | RouteDefinition, handler?: RouteHandler): this {
    if (typeof pathOrRoute === 'string') {
      if (handler === undefined) {
        throw new Error('Route handler is required');
      }
      this.routes.push({ path: normalizeRoutePath(pathOrRoute), handler });
    } else {
      this.routes.push({ path: normalizeRoutePath(pathOrRoute.path), handler: pathOrRoute.handler });
    }
    return this;
  }

  setNotFound(handler: (path: string) => Node | string | void): this {
    this.notFoundHandler = handler;
    return this;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    setCurrentRouter(this);
    window.addEventListener('hashchange', this.onHashChange);
    if (window.location.hash === '' || window.location.hash === '#') {
      window.location.hash = '#/';
    }
    this.render();
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    window.removeEventListener('hashchange', this.onHashChange);
  }

  navigate(path: string): void {
    setCurrentRouter(this);
    const target = path.startsWith('#') ? path : `#${normalizeRoutePath(path)}`;
    if (window.location.hash === target) {
      this.render();
    } else {
      window.location.hash = target;
    }
  }

  add(path: string, handler: RouteHandler): this {
    return this.register(path, handler);
  }

  addRoute(path: string, handler: RouteHandler): this {
    return this.register(path, handler);
  }

  route(path: string, handler: RouteHandler): this {
    return this.register(path, handler);
  }

  go(path: string): void {
    this.navigate(path);
  }

  currentPath(): string {
    return normalizeHash(window.location.hash);
  }

  private render(): void {
    const path = normalizeHash(window.location.hash);
    const match = matchRoute(this.routes, path);
    const result = match ? match.route.handler(match.params) : this.notFoundHandler(path);
    this.outlet.replaceChildren();
    appendResult(this.outlet, result);
  }
}

export { HashRouter as Router };

export function createRouter(outlet: HTMLElement, options?: RouterOptions): HashRouter {
  const router = new HashRouter(outlet, options);
  setCurrentRouter(router);
  return router;
}

export function navigate(path: string): void {
  if (currentRouter === null) {
    window.location.hash = path.startsWith('#') ? path : `#${normalizeRoutePath(path)}`;
    return;
  }
  currentRouter.navigate(path);
}

function normalizeHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') {
    return '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeRoutePath(path: string): string {
  const raw = path.startsWith('#') ? path.slice(1) : path;
  if (raw === '') {
    return '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function matchRoute(
  routes: RouteDefinition[],
  path: string,
): { route: RouteDefinition; params: RouteParams } | null {
  const pathSegments = path.split('/').filter((segment) => segment.length > 0);

  for (const route of routes) {
    const routeSegments = route.path.split('/').filter((segment) => segment.length > 0);
    if (routeSegments.length !== pathSegments.length) {
      continue;
    }
    const params: RouteParams = {};
    let ok = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const routeSegment = routeSegments[i] as string;
      const pathSegment = pathSegments[i] as string;
      if (routeSegment.startsWith(':')) {
        params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      } else if (routeSegment !== pathSegment) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { route, params };
    }
  }
  return null;
}

function appendResult(outlet: HTMLElement, result: Node | string | void): void {
  if (result === undefined || result === null) {
    return;
  }
  if (typeof result === 'string') {
    const paragraph = document.createElement('p');
    paragraph.textContent = result;
    outlet.append(paragraph);
    return;
  }
  if (result instanceof Node) {
    outlet.append(result);
  }
}

function defaultNotFound(path: string): Node {
  const wrapper = document.createElement('div');
  wrapper.className = 'p-4';
  const heading = document.createElement('h1');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = '404';
  const message = document.createElement('p');
  message.className = 'text-sm text-slate-600';
  message.textContent = `No route for ${path}`;
  wrapper.append(heading, message);
  return wrapper;
}
export default HashRouter;
