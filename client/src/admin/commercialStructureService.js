import {createCommercialStructureNode,getRecommendedCommercialStructureTemplate,listCommercialHeadCategories,listCommercialStructure,reorderCommercialStructureSiblings,updateCommercialHeadCategory,updateCommercialStructureNode} from '../api/commercialStructure';
export const emptyCommercialStructure=()=>({heads:[],families:[],reportingGroups:[],adoptionIssues:[]});
export function normalizeCommercialStructure(value={}){const nodes=(rows=[])=>rows.map(x=>({...x,displayOrder:Number(x.displayOrder)||0,version:Number(x.version)||1,active:x.active!==false}));return {heads:nodes(value.heads),families:nodes(value.families),reportingGroups:nodes(value.reportingGroups),adoptionIssues:Array.isArray(value.adoptionIssues)?value.adoptionIssues:[]};}
export async function loadCommercialStructure(){return normalizeCommercialStructure(await listCommercialStructure());}
export async function loadCommercialHeadCategories(){const result=await listCommercialHeadCategories();return Array.isArray(result?.categories)?result.categories:[];}
export async function loadRecommendedCommercialStructureTemplate(){return getRecommendedCommercialStructureTemplate();}
export async function saveCommercialHeadCategory(head,buildliteCategory){return updateCommercialHeadCategory(head.id,{version:head.version,buildliteCategory:buildliteCategory||null});}
export async function addStructureNode(type,payload){return createCommercialStructureNode(type,payload);}
export async function saveStructureNode(type,node,patch){return updateCommercialStructureNode(type,node.id,{name:node.name,displayOrder:node.displayOrder,active:node.active,version:node.version,...patch});}
export async function reorderStructureNodes(type,items){return normalizeCommercialStructure(await reorderCommercialStructureSiblings(type,items.map((node,index)=>({id:node.id,version:node.version,displayOrder:index}))));}
export function activeHeads(catalogue){return catalogue.heads.filter(x=>x.active);}
export function familiesFor(catalogue,headId,{includeId=null}={}){return catalogue.families.filter(x=>x.headId===headId&&(x.active||x.id===includeId));}
export function groupsFor(catalogue,headId,familyId,{includeId=null}={}){return catalogue.reportingGroups.filter(x=>x.headId===headId&&(x.familyId||null)===(familyId||null)&&(x.active||x.id===includeId));}
export function pathLabels(catalogue,path={}){const head=catalogue.heads.find(x=>x.id===path.commercialHeadId),family=catalogue.families.find(x=>x.id===path.commercialFamilyId),group=catalogue.reportingGroups.find(x=>x.id===path.reportingGroupId);return {commercialHead:head?.name||'',commercialFamily:family?.name||'',reportingGroup:group?.name||''};}
