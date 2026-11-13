import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { configureApp } from '../src/main';

/**
 * Requirement 6: "Users only see their own data."
 *
 * Boots the real Nest app (guards, pipes, controllers, Prisma) against a throwaway database.
 * Asha owns a request with a finished, recorded call (recording + transcript + summary).
 * We then prove that:
 *   - another client (Ben) can't list, read or act on any of it, on every endpoint;
 *   - a consultant who isn't assigned to Asha can't either;
 *   - the owners *can* (positive controls, so the 404s aren't just broken endpoints).
 * Foreign records return 404, not 403, so their existence isn't leaked.
 */
describe('Access control: users only see their own data', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const PASSWORD = 'pw-for-tests';

  let tokens: { consultant: string; otherConsultant: string; asha: string; ben: string };
  let ashaRequestId: string;
  let ashaCallId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string) {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    // Clean slate (children first).
    await prisma.$transaction([
      prisma.job.deleteMany(),
      prisma.summary.deleteMany(),
      prisma.transcript.deleteMany(),
      prisma.recording.deleteMany(),
      prisma.recordingChunk.deleteMany(),
      prisma.call.deleteMany(),
      prisma.helpRequest.deleteMany(),
      prisma.user.updateMany({ data: { consultantId: null } }),
      prisma.user.deleteMany(),
    ]);
    const passwordHash = hashPassword(PASSWORD);
    const consultant = await prisma.user.create({
      data: { email: 'c1@test.dev', name: 'Consultant One', role: 'CONSULTANT', passwordHash },
    });
    await prisma.user.create({ data: { email: 'c2@test.dev', name: 'Consultant Two', role: 'CONSULTANT', passwordHash } });
    for (const [email, name] of [
      ['asha@test.dev', 'Asha'],
      ['ben@test.dev', 'Ben'],
    ]) {
      await prisma.user.create({ data: { email, name, role: 'CLIENT', passwordHash, consultantId: consultant.id } });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await configureApp(app as NestExpressApplication);
    await app.init();

    tokens = {
      consultant: await login('c1@test.dev'),
      otherConsultant: await login('c2@test.dev'),
      asha: await login('asha@test.dev'),
      ben: await login('ben@test.dev'),
    };

    // Asha raises a request; her consultant calls; she consents; one chunk is recorded; the call ends.
    const req = await http()
      .post('/api/requests')
      .set(as(tokens.asha))
      .send({ title: 'Asha private issue', description: 'secret details' })
      .expect(201);
    ashaRequestId = req.body.id;
    const call = await http().post('/api/calls').set(as(tokens.consultant)).send({ requestId: ashaRequestId }).expect(201);
    ashaCallId = call.body.id;
    await prisma.call.update({ where: { id: ashaCallId }, data: { status: 'ACTIVE', startedAt: new Date() } });
    await http().post(`/api/calls/${ashaCallId}/consent`).set(as(tokens.asha)).send({ granted: true }).expect(200);
    await http()
      .post(`/api/calls/${ashaCallId}/recording/chunks?segment=0&seq=0&offsetMs=0`)
      .set(as(tokens.consultant))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('webm-bytes'))
      .expect(200);
    await http().post(`/api/calls/${ashaCallId}/end`).set(as(tokens.asha)).expect(200);

    // Simulate the finished background pipeline.
    await prisma.recording.create({
      data: { callId: ashaCallId, storageKey: `calls/${ashaCallId}/recording.webm`, mimeType: 'video/webm', sizeBytes: 10, segmentStartsMs: [0] },
    });
    await prisma.transcript.create({
      data: { callId: ashaCallId, provider: 'test', segments: [{ speaker: 'Asha (client)', role: 'CLIENT', startMs: 0, endMs: 900, text: 'my secret' }] },
    });
    await prisma.summary.create({
      data: { callId: ashaCallId, model: 'test', content: { overview: 'secret', problem: 'p', stepsTaken: [], resolution: 'r', followUps: [] } },
    });
    await prisma.call.update({ where: { id: ashaCallId }, data: { processingStatus: 'READY' } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('owners can see the request, the call, the transcript and the summary (positive control)', async () => {
    for (const token of [tokens.asha, tokens.consultant]) {
      const list = await http().get('/api/requests').set(as(token)).expect(200);
      expect(list.body.map((r: { id: string }) => r.id)).toContain(ashaRequestId);

      const detail = await http().get(`/api/calls/${ashaCallId}`).set(as(token)).expect(200);
      expect(detail.body.transcript[0].text).toBe('my secret');
      expect(detail.body.summary.overview).toBe('secret');

      await http().get(`/api/calls/${ashaCallId}/recording/url`).set(as(token)).expect(200);
    }
  });

  describe.each([
    ['another client', () => tokens.ben],
    ['an unassigned consultant', () => tokens.otherConsultant],
  ])('%s', (_who, token) => {
    it('does not see the request or the call in their lists', async () => {
      const requests = await http().get('/api/requests').set(as(token())).expect(200);
      expect(requests.body).toEqual([]);
      const calls = await http().get('/api/calls').set(as(token())).expect(200);
      expect(calls.body).toEqual([]);
    });

    it('gets 404 reading the request, the call detail (transcript + summary) and the recording', async () => {
      await http().get(`/api/requests/${ashaRequestId}`).set(as(token())).expect(404);
      const detail = await http().get(`/api/calls/${ashaCallId}`).set(as(token())).expect(404);
      expect(JSON.stringify(detail.body)).not.toContain('secret');
      await http().get(`/api/calls/${ashaCallId}/recording/url`).set(as(token())).expect(404);
    });

    it('cannot act on the call', async () => {
      await http().post(`/api/calls/${ashaCallId}/end`).set(as(token())).expect(404);
    });
  });

  it('role-specific writes are also scoped: Ben cannot consent, the other consultant cannot start or upload', async () => {
    await http().post(`/api/calls/${ashaCallId}/consent`).set(as(tokens.ben)).send({ granted: true }).expect(404);
    await http().post('/api/calls').set(as(tokens.otherConsultant)).send({ requestId: ashaRequestId }).expect(404);
    await http().post(`/api/requests/${ashaRequestId}/resolve`).set(as(tokens.otherConsultant)).expect(404);
    await http()
      .post(`/api/calls/${ashaCallId}/recording/chunks?segment=0&seq=9&offsetMs=0`)
      .set(as(tokens.otherConsultant))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(404);
  });

  it('a media token for one call cannot be used for another, and requests without a token are rejected', async () => {
    const { body } = await http().get(`/api/calls/${ashaCallId}/recording/url`).set(as(tokens.asha)).expect(200);
    const token = new URL(body.url, 'http://x').searchParams.get('token')!;
    const otherCallId = '00000000-0000-4000-8000-000000000000';
    await http().get(`/api/media/calls/${otherCallId}?token=${encodeURIComponent(token)}`).expect(404);
    await http().get(`/api/media/calls/${ashaCallId}`).expect(404);
    await http().get('/api/calls').expect(401);
  });
});
