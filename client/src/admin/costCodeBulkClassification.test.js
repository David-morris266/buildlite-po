import { describe, expect, it } from 'vitest';
import { buildClassificationReviewRows, filterClassificationCandidates } from './costCodeBulkClassification';

const codes=[
  {id:'1',code:'6100',description:'Sales fee',active:true,version:3,commercialHeadId:'h1',commercialHead:'Sales',commercialFamilyId:null,reportingGroupId:'g1',reportingGroup:'Fees'},
  {id:'2',code:'6200',description:'Marketing',active:true,version:2,commercialHeadId:'h1',commercialHead:'Sales',commercialFamilyId:'f1',commercialFamily:'Launch',reportingGroupId:'g2',reportingGroup:'Marketing'},
  {id:'3',code:'9999',description:'Historic',active:false,version:4,commercialHeadId:'h2',commercialHead:'Other',reportingGroupId:'g3'},
];
const classifications=[{costCodeKey:'6100',exists:true,semanticGroup:'SELLING',forecastDriver:'STANDARD_CVR',version:1}];

describe('bulk Cost Code classification working set',()=>{
  it('filters by hierarchy, semantic state, text and active state without inference',()=>{
    expect(filterClassificationCandidates(codes,classifications,{active:'active',commercialHeadId:'h1'}).map(x=>x.id)).toEqual(['1','2']);
    expect(filterClassificationCandidates(codes,classifications,{active:'active',commercialFamilyId:'f1'}).map(x=>x.id)).toEqual(['2']);
    expect(filterClassificationCandidates(codes,classifications,{active:'active',reportingGroupId:'g1'}).map(x=>x.id)).toEqual(['1']);
    expect(filterClassificationCandidates(codes,classifications,{active:'active',semanticGroup:'SELLING'}).map(x=>x.id)).toEqual(['1']);
    expect(filterClassificationCandidates(codes,classifications,{active:'active',semanticGroup:'UNCLASSIFIED'}).map(x=>x.id)).toEqual(['2']);
    expect(filterClassificationCandidates(codes,classifications,{active:'all',search:'historic'}).map(x=>x.id)).toEqual(['3']);
  });
  it('builds reviewed stable identities and versions only for explicit selection',()=>{
    expect(buildClassificationReviewRows(codes,classifications,new Set(['2']))).toEqual([{costCodeId:'2',costCodeKey:'6200',costCodeVersion:2,classificationVersion:0}]);
  });
});
