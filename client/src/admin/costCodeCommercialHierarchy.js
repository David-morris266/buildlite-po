import { groupsFor, pathLabels } from './commercialStructureService';

export function hierarchyOf(record={}){return {commercialHeadId:record.commercialHeadId||null,commercialFamilyId:record.commercialFamilyId||null,reportingGroupId:record.reportingGroupId||null};}
export function hierarchyLabels(record={},catalogue){const linked=pathLabels(catalogue,hierarchyOf(record));return {commercialHead:linked.commercialHead||record.commercialHead||'',commercialFamily:linked.commercialFamily||record.commercialFamily||'',reportingGroup:linked.reportingGroup||record.canonicalReportingGroup||record.reportingGroup||''};}
export function hierarchyProposal(record={},catalogue={heads:[],families:[],reportingGroups:[]}){
  if(String(record.legacy?.subHeading||'').trim().toLowerCase()!=='land')return null;
  const head=catalogue.heads.find(x=>x.active&&x.name.trim().toLowerCase()==='land');if(!head)return null;
  const desired=String(record.description||record.legacy?.element||'Land').trim().toLowerCase();
  const group=groupsFor(catalogue,head.id,null).find(x=>x.name.trim().toLowerCase()===desired);if(!group)return null;
  return {commercialHeadId:head.id,commercialFamilyId:null,reportingGroupId:group.id};
}
