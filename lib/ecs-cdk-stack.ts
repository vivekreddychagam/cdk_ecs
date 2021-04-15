import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import { NetworkLoadBalancer } from '@aws-cdk/aws-elasticloadbalancingv2';
import { Role, ServicePrincipal, PolicyStatement, Effect } from '@aws-cdk/aws-iam';
import { LogGroup } from '@aws-cdk/aws-logs';
import { SecurityGroup } from '@aws-cdk/aws-ec2';
export class EcsCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    var vpc;
    vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 });  
    const execRole = new Role(this, 'search-api-exec-role', {
      roleName: 'social-api-role', assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
    })
    //3. Adding permissions to the above created role...basically giving permissions to ECR image and Cloudwatch logs
    execRole.addToPolicy(new PolicyStatement({
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ], effect: Effect.ALLOW, resources: ["*"]
    }));

    //4. Create the ECS fargate cluster
    const cluster = new ecs.Cluster(this, 'social-api-cluster', { vpc, clusterName: "social-api-cluster" });
    const taskDef = new ecs.FargateTaskDefinition(this, "search-api-task", {
      family: 'search-api-task',
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: execRole,
      taskRole: execRole
    });

    //6. Create log group for our task to put logs
    const lg = LogGroup.fromLogGroupName(this, 'search-api-log-group',  '/ecs/search-api-task');
    const log = new ecs.AwsLogDriver({
      logGroup : lg? lg : new LogGroup(this, 'search-api-log-group',{logGroupName:'/ecs/search-api-task'
      }),
      streamPrefix : 'ecs'
    });
    var container = taskDef.addContainer("search-api-container", {
      image: ecs.ContainerImage.fromRegistry("594062188969.dkr.ecr.us-east-2.amazonaws.com/test"),
    })

    //8. Add port mappings to your container...Make sure you use TCP protocol for Network Load Balancer (NLB)
    container.addPortMappings({
      containerPort: 7070,
      hostPort: 7070,
      protocol: ecs.Protocol.TCP
    });

    //9. Create the NLB using the above VPC.
    const lb = new NetworkLoadBalancer(this, 'search-api-nlb', {
      loadBalancerName: 'search-api-nlb',
      vpc,
      internetFacing: false
    });

    //10. Add a listener on a particular port for the NLB
    const listener = lb.addListener('search-api-listener', {
      port: 7070,
    });

    //11. Create your own security Group using VPC
    const secGroup = new SecurityGroup(this, 'search-api-sg', {
      securityGroupName: "search-sg",
      vpc:vpc,
      allowAllOutbound:true
    });

    //12. Add IngressRule to access the docker image on 80 and 7070 ports 
    secGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(80), 'SSH frm anywhere');
    secGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(7070), '');

    //13. Create Fargate Service from cluster, task definition and the security group
    const fargateService = new ecs.FargateService(this, 'search-api-fg-service', {
      cluster,
      taskDefinition: taskDef, 
      assignPublicIp: true, 
      serviceName: "search-api-svc",
      securityGroup:secGroup
    });

    //14. Add fargate service to the listener 
    listener.addTargets('search-api-tg', {
      targetGroupName: 'search-api-tg',
      port: 7070,
      targets: [fargateService],
      deregistrationDelay: cdk.Duration.seconds(300)
    });

    new cdk.CfnOutput(this, 'ClusterARN: ', { value: cluster.clusterArn });
     }
        }