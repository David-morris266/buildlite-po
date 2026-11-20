// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {proposeIntendedPayment,confirmIntendedPayment} from './paymentNotices';

afterEach(()=>vi.unstubAllGlobals());
it('sends a proposal with confirm false, even if a caller passes confirm true',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,decision:{state:'proposed'}})});vi.stubGlobal('fetch',fetch);
  await proposeIntendedPayment('pkg','cert',{intendedAmount:5890,source:'manual',confirm:true});
  expect(fetch.mock.calls[0][0]).toContain('/api/packages/pkg/certificates/cert/intended-payments');
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({intendedAmount:5890,confirm:false});
});
it('retains the separate explicit confirmation helper unchanged',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,decision:{state:'confirmed'}})});vi.stubGlobal('fetch',fetch);
  await confirmIntendedPayment('pkg','cert',{intendedAmount:5890});
  expect(JSON.parse(fetch.mock.calls[0][1].body).confirm).toBe(true);
});
