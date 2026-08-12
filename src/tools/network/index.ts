import type { ToolDefinition } from '../types.js';
import { dnsLookup, reverseDns } from './dns.js';
import { httpHeadersTool, httpStatusTool, urlInfoTool } from './http.js';
import { ipInfoTool, myIpTool } from './ip.js';
import { sslInfoTool } from './ssl.js';
import { domainInfoTool } from './domain.js';
import { pingTool, portCheckTool } from './port.js';

export const networkTools: ToolDefinition[] = [
  dnsLookup,
  reverseDns,
  ipInfoTool,
  httpStatusTool,
  httpHeadersTool,
  sslInfoTool,
  urlInfoTool,
  domainInfoTool,
  portCheckTool,
  pingTool,
  myIpTool,
];

export { dnsQuery, expandIPv6 } from './dns.js';
